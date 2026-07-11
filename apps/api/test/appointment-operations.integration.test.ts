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
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppointmentModule } from "../src/appointments/appointment.module.js";
import { AppointmentOperationsService } from "../src/appointments/appointment-operations.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";

process.env.NODE_ENV ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.JWT_REFRESH_TOKEN_SECRET ??= "test-refresh-token-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";

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
    sessionId: "appointment-operations-test-session"
  };
}

describeDatabase("appointment operations integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let operations: AppointmentOperationsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, AppointmentModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    operations = moduleRef.get(AppointmentOperationsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("lets patients cancel own appointments before the window and creates refund requests for paid bookings", async () => {
    const fixture = await createAppointmentFixture("patient-cancel", {
      startsAt: futureDate(7),
      paymentMode: PaymentMode.ONLINE_OPTIONAL
    });
    const payment = await prisma.payment.create({
      data: {
        appointmentId: fixture.appointmentId,
        patientId: fixture.patientId,
        provider: "mock",
        amountMinor: 250000n,
        currency: "LKR",
        status: PaymentStatus.SUCCESSFUL,
        paidAt: new Date()
      }
    });

    const response = await operations.cancelPatientAppointment(
      fixture.patientActor,
      fixture.appointmentId,
      { reason: "Cannot attend", overridePolicy: false },
      context
    );
    const historyCount = await prisma.appointmentStatusHistory.count({
      where: {
        appointmentId: fixture.appointmentId,
        toStatus: AppointmentStatus.CANCELLED_BY_PATIENT
      }
    });
    const refund = await prisma.refund.findFirstOrThrow({
      where: {
        paymentId: payment.id,
        appointmentId: fixture.appointmentId
      }
    });

    expect(response.appointment.status).toBe("cancelled_by_patient");
    expect(historyCount).toBe(1);
    expect(refund.amountMinor).toBe(250000n);
  });

  it("rejects patient cancellation after the configured cancellation window", async () => {
    const fixture = await createAppointmentFixture("patient-window", {
      startsAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    await expect(
      operations.cancelPatientAppointment(
        fixture.patientActor,
        fixture.appointmentId,
        { reason: "Too late", overridePolicy: false },
        context
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CANCELLATION_WINDOW_CLOSED" })
    });
  });

  it("does not let a patient cancel another patient's appointment", async () => {
    const fixture = await createAppointmentFixture("patient-scope");
    const otherPatient = await createPatient("patient-scope-other");

    await expect(
      operations.cancelPatientAppointment(
        otherPatient.actor,
        fixture.appointmentId,
        { reason: "Wrong user", overridePolicy: false },
        context
      )
    ).rejects.toThrow("Appointment not found");
  });

  it("lets doctors list and complete only their own appointments", async () => {
    const fixture = await createAppointmentFixture("doctor-complete");
    const otherFixture = await createAppointmentFixture("doctor-complete-other");

    const listResponse = await operations.listDoctorAppointments(fixture.doctorActor, {
      limit: 20
    });
    const statusResponse = await operations.updateDoctorAppointmentStatus(
      fixture.doctorActor,
      fixture.appointmentId,
      { status: "completed", reason: "Consultation complete" },
      context
    );

    expect(listResponse.appointments.map((appointment) => appointment.id)).toContain(
      fixture.appointmentId
    );
    expect(statusResponse.appointment.status).toBe("completed");
    expect(statusResponse.appointment.completedAt).toEqual(expect.any(String));
    await expect(
      operations.updateDoctorAppointmentStatus(
        fixture.doctorActor,
        otherFixture.appointmentId,
        { status: "completed", reason: "Not mine" },
        context
      )
    ).rejects.toThrow("Appointment not found");
  });

  it("lets clinic staff check in appointments and record offline payments", async () => {
    const fixture = await createAppointmentFixture("clinic-check-in", {
      paymentMode: PaymentMode.PAY_AT_CLINIC
    });
    const receptionist = await createReceptionist(
      "clinic-check-in",
      fixture.clinicId,
      fixture.clinicLocationId
    );

    const checkInResponse = await operations.checkInClinicAppointment(
      receptionist.actor,
      fixture.clinicId,
      fixture.appointmentId,
      { reason: "Patient arrived" },
      context
    );
    const paymentResponse = await operations.recordOfflinePayment(
      receptionist.actor,
      fixture.clinicId,
      fixture.appointmentId,
      {
        amountMinor: 250000n,
        paymentMethod: "cash",
        reason: "Paid at desk"
      },
      context
    );

    expect(checkInResponse.appointment.status).toBe("checked_in");
    expect(checkInResponse.appointment.queueNumber).toBe(1);
    expect(paymentResponse.appointment.payments).toEqual([
      expect.objectContaining({
        status: "successful",
        provider: "offline",
        amountMinor: "250000"
      })
    ]);
  });

  it("keeps location-scoped receptionists inside their assigned location", async () => {
    const firstFixture = await createAppointmentFixture("receptionist-location-first");
    const secondFixture = await createAppointmentFixture("receptionist-location-second", {
      clinicId: firstFixture.clinicId
    });
    const receptionist = await createReceptionist(
      "receptionist-location",
      firstFixture.clinicId,
      firstFixture.clinicLocationId
    );

    const response = await operations.listClinicAppointments(receptionist.actor, firstFixture.clinicId, {
      limit: 20
    });

    expect(response.appointments.map((appointment) => appointment.id)).toContain(
      firstFixture.appointmentId
    );
    expect(response.appointments.map((appointment) => appointment.id)).not.toContain(
      secondFixture.appointmentId
    );
  });

  async function createAppointmentFixture(
    prefix: string,
    options: {
      startsAt?: Date;
      paymentMode?: PaymentMode;
      clinicId?: string;
    } = {}
  ) {
    const patient = await createPatient(prefix);
    const doctorUserId = await createUserWithRole(`${prefix}-doctor`, "doctor");
    const doctorActor = asUser(doctorUserId, ["doctor"]);
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUserId,
        slug: uniqueSlug(`${prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const clinic =
      options.clinicId !== undefined
        ? await prisma.clinic.findUniqueOrThrow({ where: { id: options.clinicId } })
        : await prisma.clinic.create({
            data: {
              name: "Appointment Operations Clinic",
              slug: uniqueSlug(`${prefix}-clinic`),
              status: ClinicStatus.ACTIVE,
              defaultPaymentMode: null,
              cancellationWindowMinutes: 30
            }
          });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Lifecycle Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Lifecycle Consultation ${prefix}`,
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
        feeMinor: 250000n,
        currency: "LKR",
        paymentMode: options.paymentMode ?? PaymentMode.PAY_AT_CLINIC,
        cancellationWindowMinutes: 30,
        isActive: true
      }
    });
    const startsAt = options.startsAt ?? futureDate(14);
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
        patientId: patient.patientId,
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        slotId: slot.id,
        startsAt,
        endsAt,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: options.paymentMode ?? PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Lifecycle Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.patientId,
        attendingNameSnapshot: "Appointment Operations Patient",
        createdByUserId: patient.actor.id
      }
    });

    return {
      patientActor: patient.actor,
      patientId: patient.patientId,
      doctorActor,
      doctorId: doctor.id,
      clinicId: clinic.id,
      clinicLocationId: clinicLocation.id,
      appointmentId: appointment.id
    };
  }

  async function createPatient(prefix: string) {
    const userId = await createUserWithRole(`${prefix}-patient`, "patient");
    const patient = await prisma.patient.create({
      data: {
        userId
      }
    });

    return {
      actor: asUser(userId, ["patient"]),
      patientId: patient.id
    };
  }

  async function createReceptionist(prefix: string, clinicId: string, clinicLocationId: string) {
    const userId = await createUserWithRole(`${prefix}-receptionist`, "receptionist");

    await prisma.receptionist.create({
      data: {
        clinicId,
        clinicLocationId,
        userId,
        status: ClinicAssociationStatus.APPROVED
      }
    });

    return {
      actor: asUser(userId, ["receptionist"])
    };
  }

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Appointment Operations User",
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            roleId: role.id
          }
        }
      },
      select: { id: true }
    });

    return user.id;
  }
});

function futureDate(daysFromNow: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(4, 30, 0, 0);

  return date;
}
