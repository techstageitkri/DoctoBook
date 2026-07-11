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
  SlotHoldStatus,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expirePaymentHolds } from "../src/payment-holds.js";

process.env.NODE_ENV ??= "test";

const runDatabaseTests =
  process.env.RUN_WORKER_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const testDate = "2036-01-08";

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describeDatabase("payment hold expiration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("expires unpaid pending appointments and confirms appointments with successful payments", async () => {
    const now = new Date();
    const unpaid = await createExpiredHoldFixture("unpaid-hold", false);
    const paid = await createExpiredHoldFixture("paid-hold", true);

    const result = await expirePaymentHolds(prisma, now);
    const unpaidAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: unpaid.appointmentId }
    });
    const unpaidHold = await prisma.appointmentSlotHold.findUniqueOrThrow({
      where: { id: unpaid.holdId }
    });
    const paidAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: paid.appointmentId }
    });
    const paidHold = await prisma.appointmentSlotHold.findUniqueOrThrow({
      where: { id: paid.holdId }
    });

    expect(result).toEqual(
      expect.objectContaining({
        converted: expect.any(Number),
        expired: expect.any(Number)
      })
    );
    expect(result.converted).toBeGreaterThanOrEqual(1);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(unpaidAppointment.status).toBe(AppointmentStatus.EXPIRED);
    expect(unpaidHold.status).toBe(SlotHoldStatus.EXPIRED);
    expect(unpaidHold.resolvedAt).toEqual(now);
    expect(paidAppointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(paidHold.status).toBe(SlotHoldStatus.CONVERTED);
    expect(paidHold.resolvedAt).toEqual(now);
  });

  async function createExpiredHoldFixture(prefix: string, createSuccessfulPayment: boolean) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Hold Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: { userId: user.id }
    });
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-doctor`),
        fullName: "Hold Test Doctor",
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
        name: "Hold Test Clinic",
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode: PaymentMode.ONLINE_REQUIRED
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Hold Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Hold Consultation ${prefix}`,
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
        defaultConsultationFeeMinor: 300000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: 300000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        isActive: true
      }
    });
    const startsAt = colomboUtc(testDate, "09:00");
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
        status: AppointmentStatus.PENDING_PAYMENT,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        serviceNameSnapshot: service.name,
        serviceDurationMinutes: 30,
        feeMinor: 300000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Hold Test Patient",
        createdByUserId: user.id
      }
    });

    if (createSuccessfulPayment) {
      await prisma.payment.create({
        data: {
          appointmentId: appointment.id,
          patientId: patient.id,
          provider: "test_gateway",
          providerPaymentId: `pay-${randomUUID()}`,
          idempotencyKey: `payment-${randomUUID()}`,
          amountMinor: 300000n,
          currency: "LKR",
          status: PaymentStatus.SUCCESSFUL,
          paidAt: new Date()
        }
      });
    }

    const hold = await prisma.appointmentSlotHold.create({
      data: {
        slotId: slot.id,
        userId: user.id,
        appointmentId: appointment.id,
        idempotencyKey: `hold-${randomUUID()}`,
        status: SlotHoldStatus.ACTIVE,
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 10 * 60 * 1000)
      }
    });

    return {
      appointmentId: appointment.id,
      holdId: hold.id
    };
  }
});

function colomboUtc(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;

  return new Date(`${date}T${normalized}+05:30`);
}
