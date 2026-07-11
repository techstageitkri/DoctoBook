import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentStatus,
  RefundStatus,
  RescheduleRequestStatus,
  SlotHoldStatus,
  UserStatus
} from "@doctobook/database";
import { createMockWebhookSignature } from "@doctobook/payments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppointmentModule } from "../src/appointments/appointment.module.js";
import { AppointmentRescheduleService } from "../src/appointments/appointment-reschedule.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { PaymentModule } from "../src/payments/payment.module.js";
import { PaymentService } from "../src/payments/payment.service.js";

process.env.NODE_ENV ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.JWT_REFRESH_TOKEN_SECRET ??= "test-refresh-token-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";
process.env.PAYMENT_PROVIDER ??= "mock";
process.env.MOCK_PAYMENT_WEBHOOK_SECRET ??= "development-mock-payment-secret";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const context: RequestContext = {
  ipAddress: "127.0.0.1",
  userAgent: "vitest"
};

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function asUser(id: string, roles: string[]): AuthenticatedUser {
  return {
    id,
    roles,
    sessionId: "appointment-reschedule-test-session"
  };
}

describeDatabase("appointment rescheduling integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reschedules: AppointmentRescheduleService;
  let payments: PaymentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, AppointmentModule, PaymentModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    reschedules = moduleRef.get(AppointmentRescheduleService);
    payments = moduleRef.get(PaymentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("applies same-price rescheduling atomically", async () => {
    const fixture = await createRescheduleFixture("same-price", {
      appointmentFeeMinor: 250000n,
      currentServiceFeeMinor: 250000n,
      paymentMode: PaymentMode.PAY_AT_CLINIC
    });

    const response = await reschedules.createPatientReschedule(
      fixture.patientActor,
      fixture.appointmentId,
      { replacementSlotId: fixture.replacementSlotId },
      `reschedule-${randomUUID()}`,
      context
    );
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const request = await prisma.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: response.rescheduleRequest.id }
    });

    expect(response.rescheduleRequest.status).toBe("completed");
    expect(response.rescheduleRequest.rawStatus).toBe("applied");
    expect(appointment.slotId).toBe(fixture.replacementSlotId);
    expect(appointment.startsAt).toEqual(fixture.replacementStartsAt);
    expect(request.status).toBe(RescheduleRequestStatus.APPLIED);
    expect(request.resolvedAt).toBeInstanceOf(Date);
  });

  it("keeps the original appointment until a higher-price difference payment succeeds", async () => {
    const fixture = await createRescheduleFixture("higher-price", {
      appointmentFeeMinor: 250000n,
      currentServiceFeeMinor: 300000n,
      paymentMode: PaymentMode.ONLINE_REQUIRED,
      createSuccessfulPayment: true
    });

    const response = await reschedules.createPatientReschedule(
      fixture.patientActor,
      fixture.appointmentId,
      { replacementSlotId: fixture.replacementSlotId },
      `reschedule-${randomUUID()}`,
      context
    );
    const pendingAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const request = await prisma.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: response.rescheduleRequest.id },
      include: { holds: true, payments: true }
    });

    expect(response.rescheduleRequest.status).toBe("pending_payment");
    expect(response.rescheduleRequest.rawStatus).toBe("requested");
    expect(pendingAppointment.slotId).toBe(fixture.originalSlotId);
    expect(request.holds).toEqual([
      expect.objectContaining({
        slotId: fixture.replacementSlotId,
        status: SlotHoldStatus.ACTIVE
      })
    ]);
    expect(request.payments).toEqual([
      expect.objectContaining({
        amountMinor: 50000n
      })
    ]);
    expect([PaymentStatus.INITIATED, PaymentStatus.PENDING]).toContain(
      request.payments[0]?.status
    );

    const payment = request.payments[0]!;
    const payload = {
      paymentId: payment.id,
      status: "successful",
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      providerPaymentId: `mock-${payment.id}`,
      eventId: `mock-event-${randomUUID()}`
    };

    await payments.processWebhook("mock", payload, {
      "x-mock-payment-signature": createMockWebhookSignature(payload)
    });

    const appliedAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const appliedRequest = await prisma.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: request.id }
    });
    const convertedHold = await prisma.appointmentSlotHold.findFirstOrThrow({
      where: { rescheduleRequestId: request.id }
    });

    expect(appliedAppointment.slotId).toBe(fixture.replacementSlotId);
    expect(appliedAppointment.feeMinor).toBe(300000n);
    expect(appliedRequest.status).toBe(RescheduleRequestStatus.APPLIED);
    expect(convertedHold.status).toBe(SlotHoldStatus.CONVERTED);
  });

  it("creates a refund request for lower-price rescheduling", async () => {
    const fixture = await createRescheduleFixture("lower-price", {
      appointmentFeeMinor: 300000n,
      currentServiceFeeMinor: 250000n,
      paymentMode: PaymentMode.ONLINE_REQUIRED,
      createSuccessfulPayment: true
    });

    const response = await reschedules.createPatientReschedule(
      fixture.patientActor,
      fixture.appointmentId,
      { replacementSlotId: fixture.replacementSlotId },
      `reschedule-${randomUUID()}`,
      context
    );
    const refund = await prisma.refund.findFirstOrThrow({
      where: { appointmentId: fixture.appointmentId }
    });

    expect(response.rescheduleRequest.status).toBe("completed");
    expect(response.rescheduleRequest.rawStatus).toBe("applied");
    expect(refund.amountMinor).toBe(50000n);
    expect([
      RefundStatus.REQUESTED,
      RefundStatus.PROCESSING,
      RefundStatus.PROCESSED
    ]).toContain(refund.status);
  });

  it("rejects another patient and detects idempotency key reuse", async () => {
    const fixture = await createRescheduleFixture("reschedule-idempotency", {
      appointmentFeeMinor: 250000n,
      currentServiceFeeMinor: 250000n,
      paymentMode: PaymentMode.PAY_AT_CLINIC
    });
    const otherPatient = await createPatient("reschedule-idempotency-other");
    const idempotencyKey = `reschedule-${randomUUID()}`;

    await expect(
      reschedules.createPatientReschedule(
        otherPatient.actor,
        fixture.appointmentId,
        { replacementSlotId: fixture.replacementSlotId },
        `reschedule-${randomUUID()}`,
        context
      )
    ).rejects.toThrow("Appointment not found");

    const first = await reschedules.createPatientReschedule(
      fixture.patientActor,
      fixture.appointmentId,
      { replacementSlotId: fixture.replacementSlotId },
      idempotencyKey,
      context
    );
    const replay = await reschedules.createPatientReschedule(
      fixture.patientActor,
      fixture.appointmentId,
      { replacementSlotId: fixture.replacementSlotId },
      idempotencyKey,
      context
    );

    expect(replay).toEqual({
      ...first,
      idempotentReplay: true
    });

    const anotherSlot = await createReplacementSlot(fixture, 21);

    await expect(
      reschedules.createPatientReschedule(
        fixture.patientActor,
        fixture.appointmentId,
        { replacementSlotId: anotherSlot.id },
        idempotencyKey,
        context
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" })
    });
  });

  async function createRescheduleFixture(
    prefix: string,
    options: {
      appointmentFeeMinor: bigint;
      currentServiceFeeMinor: bigint;
      paymentMode: PaymentMode;
      createSuccessfulPayment?: boolean;
    }
  ) {
    const patient = await createPatient(prefix);
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-doctor`),
        fullName: "Reschedule Test Doctor",
        status: UserStatus.ACTIVE
      }
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug(`${prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const clinic = await prisma.clinic.create({
      data: {
        name: "Reschedule Test Clinic",
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode: null
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Reschedule Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Reschedule Consultation ${prefix}`,
        slug: uniqueSlug(`${prefix}-service`),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId: clinic.id,
        serviceId: service.id,
        isActive: true
      }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        status: ClinicAssociationStatus.APPROVED,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: options.currentServiceFeeMinor,
        currency: "LKR",
        paymentMode: options.paymentMode,
        rescheduleWindowMinutes: 30,
        maxReschedules: 3,
        isActive: true
      }
    });
    const originalStartsAt = futureDate(14);
    const originalEndsAt = new Date(originalStartsAt.getTime() + 30 * 60 * 1000);
    const originalSlot = await prisma.appointmentSlot.create({
      data: {
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt: originalStartsAt,
        endsAt: originalEndsAt,
        isActive: true
      }
    });
    const replacementStartsAt = futureDate(15);
    const replacementEndsAt = new Date(replacementStartsAt.getTime() + 30 * 60 * 1000);
    const replacementSlot = await prisma.appointmentSlot.create({
      data: {
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt: replacementStartsAt,
        endsAt: replacementEndsAt,
        isActive: true
      }
    });
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.patientId,
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        slotId: originalSlot.id,
        startsAt: originalStartsAt,
        endsAt: originalEndsAt,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: options.paymentMode,
        serviceNameSnapshot: service.name,
        serviceDurationMinutes: 30,
        feeMinor: options.appointmentFeeMinor,
        currency: "LKR",
        attendingPatientId: patient.patientId,
        attendingNameSnapshot: "Reschedule Test Patient",
        createdByUserId: patient.actor.id
      }
    });

    if (options.createSuccessfulPayment) {
      await prisma.payment.create({
        data: {
          appointmentId: appointment.id,
          patientId: patient.patientId,
          provider: "mock",
          providerPaymentId: `mock-parent-${randomUUID()}`,
          amountMinor: options.appointmentFeeMinor,
          currency: "LKR",
          status: PaymentStatus.SUCCESSFUL,
          paidAt: new Date()
        }
      });
    }

    return {
      patientActor: patient.actor,
      patientId: patient.patientId,
      appointmentId: appointment.id,
      doctorClinicId: doctorClinic.id,
      doctorClinicServiceId: doctorClinicService.id,
      originalSlotId: originalSlot.id,
      replacementSlotId: replacementSlot.id,
      replacementStartsAt
    };
  }

  async function createReplacementSlot(
    fixture: {
      doctorClinicId: string;
      doctorClinicServiceId: string;
    },
    daysFromNow: number
  ) {
    const startsAt = futureDate(daysFromNow);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    return prisma.appointmentSlot.create({
      data: {
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceId,
        startsAt,
        endsAt,
        isActive: true
      }
    });
  }

  async function createPatient(prefix: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Reschedule Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: { userId: user.id }
    });

    return {
      actor: asUser(user.id, ["patient"]),
      patientId: patient.id
    };
  }
});

function futureDate(daysFromNow: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(4, 30, 0, 0);

  return date;
}
