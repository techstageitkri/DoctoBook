import { randomUUID } from "node:crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentStatus,
  PrismaClient,
  RefundStatus,
  UserStatus
} from "@doctobook/database";
import { processStoredRefund } from "@doctobook/payments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV ??= "test";
process.env.PAYMENT_PROVIDER ??= "mock";

const runDatabaseTests =
  process.env.RUN_WORKER_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describeDatabase("refund processing", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("processes requested refunds through the payment provider and records history", async () => {
    const fixture = await createRefundFixture("refund-worker", 50000n);

    const result = await processStoredRefund(prisma, fixture.refundId, process.env);
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: fixture.refundId }
    });
    const history = await prisma.refundStatusHistory.findMany({
      where: { refundId: fixture.refundId },
      orderBy: { createdAt: "asc" }
    });
    const duplicate = await processStoredRefund(prisma, fixture.refundId, process.env);

    expect(result).toEqual(
      expect.objectContaining({
        processed: true,
        status: "processed",
        providerRefundId: `mock-refund-${fixture.refundId}`
      })
    );
    expect(refund.status).toBe(RefundStatus.PROCESSED);
    expect(refund.providerRefundId).toBe(`mock-refund-${fixture.refundId}`);
    expect(history.map((entry) => entry.toStatus)).toEqual([
      RefundStatus.PROCESSING,
      RefundStatus.PROCESSED
    ]);
    expect(duplicate).toEqual(
      expect.objectContaining({
        processed: false,
        duplicate: true
      })
    );
  });

  it("does not allow processing refunds beyond the successful payment amount", async () => {
    const fixture = await createRefundFixture("refund-overflow", 200000n);

    await prisma.refund.create({
      data: {
        paymentId: fixture.paymentId,
        appointmentId: fixture.appointmentId,
        requestedByUserId: fixture.userId,
        provider: "mock",
        amountMinor: 100000n,
        currency: "LKR",
        status: RefundStatus.PROCESSED,
        reason: "Existing refund",
        processedAt: new Date()
      }
    });

    await expect(processStoredRefund(prisma, fixture.refundId, process.env)).rejects.toThrow();
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: fixture.refundId }
    });

    expect(refund.status).toBe(RefundStatus.REQUESTED);
  });

  async function createRefundFixture(prefix: string, refundAmount: bigint) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Refund Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: { userId: user.id }
    });
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-doctor`),
        fullName: "Refund Test Doctor",
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
        name: "Refund Test Clinic",
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Refund Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Refund Consultation ${prefix}`,
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
        feeMinor: 200000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        isActive: true
      }
    });
    const startsAt = futureDate(14);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const slot = await prisma.appointmentSlot.create({
      data: {
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt,
        endsAt,
        isActive: true
      }
    });
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        slotId: slot.id,
        startsAt,
        endsAt,
        status: AppointmentStatus.CANCELLED_BY_PATIENT,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        serviceNameSnapshot: service.name,
        serviceDurationMinutes: 30,
        feeMinor: 200000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Refund Test Patient",
        cancelledAt: new Date(),
        cancellationReason: "Refund test",
        createdByUserId: user.id
      }
    });
    const payment = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        provider: "mock",
        providerPaymentId: `mock-payment-${randomUUID()}`,
        amountMinor: 200000n,
        currency: "LKR",
        status: PaymentStatus.SUCCESSFUL,
        paidAt: new Date()
      }
    });
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        appointmentId: appointment.id,
        requestedByUserId: user.id,
        provider: "mock",
        amountMinor: refundAmount,
        currency: "LKR",
        status: RefundStatus.REQUESTED,
        reason: "Refund requested"
      }
    });

    return {
      userId: user.id,
      appointmentId: appointment.id,
      paymentId: payment.id,
      refundId: refund.id
    };
  }
});

function futureDate(daysFromNow: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(4, 30, 0, 0);

  return date;
}
