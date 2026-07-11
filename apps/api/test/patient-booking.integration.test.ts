import { randomUUID } from "node:crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentStatus,
  SlotHoldStatus,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthenticatedUser } from "../src/auth/auth.types.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AppointmentBookingService } from "../src/appointments/appointment.service.js";
import {
  InitiatePaymentJob,
  PaymentQueueService
} from "../src/appointments/payment-queue.service.js";

process.env.NODE_ENV ??= "test";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const testDate = "2036-01-07";

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

class FakePaymentQueueService {
  readonly jobs: InitiatePaymentJob[] = [];

  async enqueuePaymentInitiation(input: InitiatePaymentJob) {
    this.jobs.push(input);

    return input;
  }
}

describeDatabase("patient appointment booking", () => {
  let prisma: PrismaService;
  let paymentQueue: FakePaymentQueueService;
  let bookings: AppointmentBookingService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    paymentQueue = new FakePaymentQueueService();
    bookings = new AppointmentBookingService(
      prisma,
      paymentQueue as unknown as PaymentQueueService
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("confirms pay-at-clinic bookings without creating a payment hold", async () => {
    const fixture = await createBookingFixture({
      prefix: "pay-at-clinic",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 250000n
    });

    const response = await createBooking(fixture, {
      paymentPreference: "pay_at_clinic"
    });
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: response.appointmentId },
      include: { holds: true, payments: true }
    });

    expect(response).toEqual(
      expect.objectContaining({
        status: "confirmed",
        idempotentReplay: false,
        payment: null
      })
    );
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment.holds).toHaveLength(0);
    expect(appointment.payments).toHaveLength(0);
    expect(appointment.feeMinor).toBe(250000n);

    await prisma.doctorClinicService.update({
      where: { id: fixture.doctorClinicServiceId },
      data: { feeMinor: 999999n }
    });
    const unchangedAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: response.appointmentId },
      select: { feeMinor: true }
    });

    expect(unchangedAppointment.feeMinor).toBe(250000n);
  });

  it("replays the same idempotency key and rejects key reuse with a different payload", async () => {
    const fixture = await createBookingFixture({
      prefix: "idempotent",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 200000n
    });
    const idempotencyKey = `booking-${randomUUID()}`;

    const firstResponse = await createBooking(fixture, {
      idempotencyKey,
      reasonForVisit: "Initial reason",
      paymentPreference: "pay_at_clinic"
    });
    const replayResponse = await createBooking(fixture, {
      idempotencyKey,
      reasonForVisit: "Initial reason",
      paymentPreference: "pay_at_clinic"
    });

    expect(replayResponse).toEqual({
      ...firstResponse,
      idempotentReplay: true
    });
    await expectErrorCode(
      createBooking(fixture, {
        idempotencyKey,
        reasonForVisit: "Changed reason",
        paymentPreference: "pay_at_clinic"
      }),
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("creates a pending payment appointment, active hold, and initiated payment for online-required bookings", async () => {
    const fixture = await createBookingFixture({
      prefix: "online-required",
      paymentMode: PaymentMode.ONLINE_REQUIRED,
      feeMinor: 400000n
    });

    const response = await createBooking(fixture, {
      paymentPreference: "online"
    });
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: response.appointmentId },
      include: { holds: true, payments: true }
    });

    expect(response.status).toBe("pending_payment");
    expect(response.payment).toEqual(
      expect.objectContaining({
        status: "initiated",
        amountMinor: "400000",
        redirectPending: true
      })
    );
    expect(appointment.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    expect(appointment.holds).toEqual([
      expect.objectContaining({
        status: SlotHoldStatus.ACTIVE,
        appointmentId: appointment.id
      })
    ]);
    expect(appointment.payments).toEqual([
      expect.objectContaining({
        status: PaymentStatus.INITIATED,
        amountMinor: 400000n
      })
    ]);
    expect(paymentQueue.jobs).toContainEqual({
      appointmentId: appointment.id,
      paymentId: appointment.payments[0]?.id
    });
  });

  it("blocks a second booking for an already confirmed slot", async () => {
    const fixture = await createBookingFixture({
      prefix: "confirmed-conflict",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 150000n
    });
    const secondPatient = await createPatient("confirmed-conflict-second");

    await createBooking(fixture, {
      paymentPreference: "pay_at_clinic"
    });
    await expectErrorCode(
      createBooking(
        {
          ...fixture,
          actor: secondPatient.actor,
          patientId: secondPatient.patientId
        },
        {
          paymentPreference: "pay_at_clinic"
        }
      ),
      "SLOT_ALREADY_BOOKED"
    );
  });

  it("expires stale holds inside the booking transaction before accepting a replacement booking", async () => {
    const fixture = await createBookingFixture({
      prefix: "expired-hold",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 150000n
    });
    const stalePatient = await createPatient("expired-hold-stale");
    const staleAppointment = await createRawAppointment(fixture, {
      patientId: stalePatient.patientId,
      userId: stalePatient.actor.id,
      status: AppointmentStatus.PENDING_PAYMENT
    });
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const expiresAt = new Date(Date.now() - 10 * 60 * 1000);
    const staleHold = await prisma.appointmentSlotHold.create({
      data: {
        slotId: fixture.slotId,
        userId: stalePatient.actor.id,
        appointmentId: staleAppointment.id,
        idempotencyKey: `stale-hold-${randomUUID()}`,
        status: SlotHoldStatus.ACTIVE,
        createdAt,
        expiresAt
      }
    });

    const response = await createBooking(fixture, {
      paymentPreference: "pay_at_clinic"
    });
    const updatedHold = await prisma.appointmentSlotHold.findUniqueOrThrow({
      where: { id: staleHold.id }
    });
    const updatedStaleAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: staleAppointment.id }
    });

    expect(response.status).toBe("confirmed");
    expect(updatedHold.status).toBe(SlotHoldStatus.EXPIRED);
    expect(updatedHold.resolvedAt).toBeInstanceOf(Date);
    expect(updatedStaleAppointment.status).toBe(AppointmentStatus.EXPIRED);
  });

  it("rejects dependents that do not belong to the booking patient", async () => {
    const fixture = await createBookingFixture({
      prefix: "dependent-owner",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 150000n
    });
    const otherPatient = await createPatient("dependent-owner-other");
    const otherDependent = await prisma.patientDependent.create({
      data: {
        patientId: otherPatient.patientId,
        fullName: "Other Dependent",
        relationship: "child",
        isActive: true
      }
    });

    await expectErrorCode(
      bookings.createPatientAppointment(
        fixture.actor,
        {
          appointmentSlotId: fixture.slotId,
          attendingDependentId: otherDependent.id,
          paymentPreference: "pay_at_clinic"
        },
        `booking-${randomUUID()}`,
        {}
      ),
      "INVALID_ATTENDING_DEPENDENT"
    );
  });

  it("rejects slots whose doctor, clinic, or service is no longer bookable", async () => {
    const fixture = await createBookingFixture({
      prefix: "suspended-doctor",
      paymentMode: PaymentMode.PAY_AT_CLINIC,
      feeMinor: 150000n
    });

    await prisma.doctor.update({
      where: { id: fixture.doctorId },
      data: { status: DoctorStatus.SUSPENDED }
    });

    await expectErrorCode(
      createBooking(fixture, {
        paymentPreference: "pay_at_clinic"
      }),
      "SLOT_NOT_BOOKABLE"
    );
  });

  async function createBooking(
    fixture: BookingFixture,
    options: {
      idempotencyKey?: string;
      reasonForVisit?: string | null;
      paymentPreference: "online" | "pay_at_clinic";
    }
  ) {
    return bookings.createPatientAppointment(
      fixture.actor,
      {
        appointmentSlotId: fixture.slotId,
        attendingPatientId: fixture.patientId,
        reasonForVisit: options.reasonForVisit,
        paymentPreference: options.paymentPreference
      },
      options.idempotencyKey ?? `booking-${randomUUID()}`,
      {
        ipAddress: "127.0.0.1",
        userAgent: "vitest"
      }
    );
  }

  async function createBookingFixture(input: {
    prefix: string;
    paymentMode: PaymentMode;
    feeMinor: bigint;
  }) {
    const patient = await createPatient(input.prefix);
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${input.prefix}-doctor`),
        fullName: "Booking Test Doctor",
        status: UserStatus.ACTIVE
      }
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug(`${input.prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const clinic = await prisma.clinic.create({
      data: {
        name: "Booking Test Clinic",
        slug: uniqueSlug(`${input.prefix}-clinic`),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode: null
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Booking Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Booking Consultation ${input.prefix}`,
        slug: uniqueSlug(`${input.prefix}-service`),
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
        defaultConsultationFeeMinor: null,
        currency: "LKR",
        paymentMode: null,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: input.feeMinor,
        currency: "LKR",
        paymentMode: input.paymentMode,
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

    return {
      actor: patient.actor,
      patientId: patient.patientId,
      doctorId: doctor.id,
      clinicId: clinic.id,
      clinicLocationId: clinicLocation.id,
      doctorClinicId: doctorClinic.id,
      doctorClinicServiceId: doctorClinicService.id,
      slotId: slot.id,
      startsAt,
      endsAt
    } satisfies BookingFixture;
  }

  async function createPatient(prefix: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Booking Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: {
        userId: user.id
      }
    });

    return {
      actor: {
        id: user.id,
        sessionId: randomUUID(),
        roles: ["patient"]
      } satisfies AuthenticatedUser,
      patientId: patient.id
    };
  }

  async function createRawAppointment(
    fixture: BookingFixture,
    input: {
      patientId: string;
      userId: string;
      status: AppointmentStatus;
    }
  ) {
    return prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: input.patientId,
        doctorId: fixture.doctorId,
        clinicId: fixture.clinicId,
        clinicLocationId: fixture.clinicLocationId,
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceId,
        slotId: fixture.slotId,
        startsAt: fixture.startsAt,
        endsAt: fixture.endsAt,
        status: input.status,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        serviceNameSnapshot: "Booking Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 150000n,
        currency: "LKR",
        attendingPatientId: input.patientId,
        attendingNameSnapshot: "Booking Test Patient",
        createdByUserId: input.userId
      }
    });
  }
});

async function expectErrorCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({
    response: expect.objectContaining({ code })
  });
}

function colomboUtc(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;

  return new Date(`${date}T${normalized}+05:30`);
}

type BookingFixture = {
  actor: AuthenticatedUser;
  patientId: string;
  doctorId: string;
  clinicId: string;
  clinicLocationId: string;
  doctorClinicId: string;
  doctorClinicServiceId: string;
  slotId: string;
  startsAt: Date;
  endsAt: Date;
};
