import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  NotificationChannel,
  NotificationStatus,
  PaymentMode,
  PaymentStatus,
  RefundStatus,
  ReviewStatus,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthenticatedUser } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ReportModule } from "../src/reports/report.module.js";
import { ReportService } from "../src/reports/report.service.js";

process.env.NODE_ENV ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.JWT_REFRESH_TOKEN_SECRET ??= "test-refresh-token-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function actor(id: string, roles: string[]): AuthenticatedUser {
  return { id, roles, sessionId: "report-test-session" };
}

describeDatabase("reports integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, ReportModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportService);
    await ensureReportPermission();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("returns platform-wide appointment, revenue, notification and rating totals", async () => {
    const fixture = await createReportFixture("reports-platform");
    const overview = await reports.getAdminOverview(fixture.superAdmin, {
      from: "2026-07-01",
      to: "2026-07-31",
      groupBy: "day",
      timezone: "Asia/Colombo",
      limit: 50
    });

    expect(overview.summary.totalAppointments).toBeGreaterThanOrEqual(3);
    expect(overview.summary.completedAppointments).toBeGreaterThanOrEqual(2);
    expect(overview.summary.noShowAppointments).toBeGreaterThanOrEqual(1);
    const lkrRevenue = overview.summary.revenueByCurrency.find((row) => row.currency === "LKR");

    expect(BigInt(lkrRevenue?.onlineRevenueMinor ?? "0")).toBeGreaterThanOrEqual(190000n);
    expect(BigInt(lkrRevenue?.offlineRevenueMinor ?? "0")).toBeGreaterThanOrEqual(50000n);
    expect(BigInt(lkrRevenue?.refundMinor ?? "0")).toBeGreaterThanOrEqual(20000n);
    expect(overview.summary.notificationDelivery.totalNotifications).toBeGreaterThanOrEqual(3);
    expect(overview.summary.notificationDelivery.sentNotifications).toBeGreaterThanOrEqual(2);
  });

  it("uses clinic scope and rejects clinic admins from another clinic", async () => {
    const fixture = await createReportFixture("reports-clinic");
    const clinicOverview = await reports.getClinicOverview(
      fixture.clinicAdmin,
      fixture.clinicId,
      {
        from: "2026-07-01",
        to: "2026-07-31",
        groupBy: "day",
        timezone: "Asia/Colombo",
        limit: 50
      }
    );

    expect(clinicOverview.summary.totalAppointments).toBe(2);
    expect(clinicOverview.summary.revenueByCurrency).toEqual([
      expect.objectContaining({
        currency: "LKR",
        onlineRevenueMinor: "100000",
        offlineRevenueMinor: "50000",
        refundMinor: "20000",
        netRevenueMinor: "130000"
      })
    ]);
    expect(clinicOverview.summary.averageRating).toBe(5);

    await expect(
      reports.getClinicOverview(fixture.clinicAdmin, fixture.otherClinicId, {
        from: "2026-07-01",
        to: "2026-07-31",
        groupBy: "day",
        timezone: "Asia/Colombo",
        limit: 50
      })
    ).rejects.toThrow("Missing required permission");
  });

  it("derives doctor report scope from the authenticated doctor", async () => {
    const fixture = await createReportFixture("reports-doctor");
    const overview = await reports.getDoctorOverview(fixture.doctorActor, {
      from: "2026-07-01",
      to: "2026-07-31",
      groupBy: "day",
      timezone: "Asia/Colombo",
      limit: 50
    });

    expect(overview.doctor.id).toBe(fixture.doctorId);
    expect(overview.summary.totalAppointments).toBe(3);
    expect(overview.summary.uniquePatients).toBe(1);
    expect(overview.summary.reviewCount).toBe(1);
    expect(overview.recentReviews).toHaveLength(1);
    expect(overview.recentReviews[0]).not.toHaveProperty("patientEmail");
  });

  it("groups appointment dates using clinic location timezone boundaries", async () => {
    const fixture = await createReportFixture("reports-timezone");
    const appointments = await reports.getClinicAppointments(
      fixture.clinicAdmin,
      fixture.clinicId,
      {
        from: "2026-07-01",
        to: "2026-07-01",
        groupBy: "day",
        timezone: "Asia/Colombo",
        limit: 50
      }
    );

    expect(appointments.summary.totalAppointments).toBe(1);
    expect(appointments.series).toEqual([
      expect.objectContaining({
        period: "2026-07-01",
        appointments: 1
      })
    ]);
  });

  async function createReportFixture(prefix: string) {
    const superAdmin = await createRoleUser(`${prefix}-super`, "super_admin");
    const clinic = await createClinic(`${prefix}-clinic`);
    const otherClinic = await createClinic(`${prefix}-other-clinic`);
    const clinicAdminUser = await createRoleUser(`${prefix}-clinic-admin`, "clinic_admin");
    await prisma.clinicAdmin.create({
      data: {
        clinicId: clinic.clinicId,
        userId: clinicAdminUser.id,
        status: ClinicAssociationStatus.APPROVED
      }
    });

    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Report Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({ data: { userId: patientUser.id } });
    const doctorUser = await createRoleUser(`${prefix}-doctor`, "doctor");
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug(`${prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const association = await createDoctorClinic(prefix, doctor.id, clinic);
    const otherAssociation = await createDoctorClinic(`${prefix}-other`, doctor.id, otherClinic);
    const appointmentOne = await createAppointment({
      prefix,
      patientId: patient.id,
      patientUserId: patientUser.id,
      doctorId: doctor.id,
      clinic,
      association,
      status: AppointmentStatus.COMPLETED,
      startsAt: new Date("2026-06-30T19:00:00.000Z"),
      amountMinor: 100000n
    });
    const paymentOneId = await createPayment(
      appointmentOne.id,
      patient.id,
      "payhere",
      100000n,
      "2026-07-01T01:00:00.000Z"
    );
    await createRefund(appointmentOne.id, paymentOneId, patientUser.id, 20000n);
    await prisma.review.create({
      data: {
        appointmentId: appointmentOne.id,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId: clinic.clinicId,
        rating: 5,
        comment: "Excellent care",
        status: ReviewStatus.APPROVED
      }
    });
    const hiddenReviewAppointment = await createAppointment({
      prefix: `${prefix}-hidden-review`,
      patientId: patient.id,
      patientUserId: patientUser.id,
      doctorId: doctor.id,
      clinic,
      association,
      status: AppointmentStatus.COMPLETED,
      startsAt: new Date("2026-05-01T04:00:00.000Z"),
      amountMinor: 100000n
    });
    await prisma.review.create({
      data: {
        appointmentId: hiddenReviewAppointment.id,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId: clinic.clinicId,
        rating: 1,
        comment: "Hidden review",
        status: ReviewStatus.HIDDEN
      }
    });

    const appointmentTwo = await createAppointment({
      prefix: `${prefix}-offline`,
      patientId: patient.id,
      patientUserId: patientUser.id,
      doctorId: doctor.id,
      clinic,
      association,
      status: AppointmentStatus.NO_SHOW,
      startsAt: new Date("2026-07-02T04:00:00.000Z"),
      amountMinor: 50000n
    });
    await createPayment(appointmentTwo.id, patient.id, "offline", 50000n, "2026-07-02T04:30:00.000Z");

    const otherAppointment = await createAppointment({
      prefix: `${prefix}-other`,
      patientId: patient.id,
      patientUserId: patientUser.id,
      doctorId: doctor.id,
      clinic: otherClinic,
      association: otherAssociation,
      status: AppointmentStatus.COMPLETED,
      startsAt: new Date("2026-07-03T04:00:00.000Z"),
      amountMinor: 90000n
    });
    await createPayment(otherAppointment.id, patient.id, "payhere", 90000n, "2026-07-03T04:30:00.000Z");

    await createAppointment({
      prefix: `${prefix}-outside-local-day`,
      patientId: patient.id,
      patientUserId: patientUser.id,
      doctorId: doctor.id,
      clinic,
      association,
      status: AppointmentStatus.CONFIRMED,
      startsAt: new Date("2026-06-30T18:00:00.000Z"),
      amountMinor: 30000n
    });

    await prisma.notificationLog.createMany({
      data: [
        notificationLog(patientUser.id, appointmentOne.id, NotificationStatus.SENT),
        notificationLog(patientUser.id, appointmentTwo.id, NotificationStatus.SENT),
        notificationLog(patientUser.id, appointmentTwo.id, NotificationStatus.FAILED)
      ]
    });

    return {
      superAdmin: actor(superAdmin.id, ["super_admin"]),
      clinicAdmin: actor(clinicAdminUser.id, ["clinic_admin"]),
      doctorActor: actor(doctorUser.id, ["doctor"]),
      clinicId: clinic.clinicId,
      otherClinicId: otherClinic.clinicId,
      doctorId: doctor.id
    };
  }

  async function createClinic(prefix: string) {
    const clinic = await prisma.clinic.create({
      data: {
        name: `Report Clinic ${prefix}`,
        slug: uniqueSlug(prefix),
        status: ClinicStatus.ACTIVE
      }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        name: "Main",
        address: "1 Report Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Report Consultation ${prefix}`,
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

    return {
      clinicId: clinic.id,
      locationId: location.id,
      clinicServiceId: clinicService.id
    };
  }

  async function createDoctorClinic(
    prefix: string,
    doctorId: string,
    clinic: { clinicId: string; locationId: string; clinicServiceId: string }
  ) {
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId,
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        status: ClinicAssociationStatus.APPROVED,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinic.clinicServiceId,
        durationMinutes: 30,
        feeMinor: 100000n,
        currency: "LKR",
        isActive: true
      }
    });

    await prisma.doctorAvailabilityRule.create({
      data: {
        doctorClinicId: doctorClinic.id,
        dayOfWeek: 3,
        startsAt: new Date("1970-01-01T09:00:00.000Z"),
        endsAt: new Date("1970-01-01T17:00:00.000Z"),
        isActive: true
      }
    });

    return {
      id: doctorClinic.id,
      doctorClinicServiceId: doctorClinicService.id,
      clinicId: clinic.clinicId,
      locationId: clinic.locationId
    };
  }

  async function createAppointment(input: {
    prefix: string;
    patientId: string;
    patientUserId: string;
    doctorId: string;
    clinic: { clinicId: string; locationId: string };
    association: { id: string; doctorClinicServiceId: string };
    status: AppointmentStatus;
    startsAt: Date;
    amountMinor: bigint;
  }) {
    const endsAt = new Date(input.startsAt.getTime() + 30 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: input.patientId,
        doctorId: input.doctorId,
        clinicId: input.clinic.clinicId,
        clinicLocationId: input.clinic.locationId,
        doctorClinicId: input.association.id,
        doctorClinicServiceId: input.association.doctorClinicServiceId,
        startsAt: input.startsAt,
        endsAt,
        status: input.status,
        completedAt: input.status === AppointmentStatus.COMPLETED ? endsAt : null,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Report Consultation",
        serviceDurationMinutes: 30,
        feeMinor: input.amountMinor,
        currency: "LKR",
        attendingPatientId: input.patientId,
        attendingNameSnapshot: "Report Test Patient",
        createdByUserId: input.patientUserId
      }
    });
    return {
      id: appointment.id,
      paymentId: null as string | null
    };
  }

  async function createPayment(
    appointmentId: string,
    patientId: string,
    provider: string,
    amountMinor: bigint,
    paidAt: string
  ) {
    const payment = await prisma.payment.create({
      data: {
        appointmentId,
        patientId,
        provider,
        providerPaymentId: `${provider}-${randomUUID()}`,
        amountMinor,
        currency: "LKR",
        status: PaymentStatus.SUCCESSFUL,
        paymentMethod: provider === "offline" ? "cash" : "card",
        paidAt: new Date(paidAt)
      }
    });

    return payment.id;
  }

  async function createRefund(
    appointmentId: string,
    paymentId: string,
    requestedByUserId: string,
    amountMinor: bigint
  ) {
    await prisma.refund.create({
      data: {
        appointmentId,
        paymentId,
        requestedByUserId,
        provider: "payhere",
        providerRefundId: `refund-${randomUUID()}`,
        amountMinor,
        currency: "LKR",
        status: RefundStatus.PROCESSED,
        reason: "Report refund",
        processedAt: new Date("2026-07-01T02:00:00.000Z")
      }
    });
  }

  function notificationLog(userId: string, appointmentId: string, status: NotificationStatus) {
    return {
      userId,
      appointmentId,
      channel: NotificationChannel.EMAIL,
      eventCode: `report.notification.${randomUUID()}`,
      idempotencyKey: `report-${randomUUID()}`,
      recipient: uniqueEmail("report-recipient"),
      subject: "Report notification",
      body: "Body",
      status,
      provider: "mock_email",
      providerMessageId: `message-${randomUUID()}`,
      sentAt: status === NotificationStatus.SENT ? new Date("2026-07-01T03:00:00.000Z") : null,
      createdAt: new Date("2026-07-01T03:00:00.000Z")
    };
  }

  async function createRoleUser(prefix: string, roleCode: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: `Report ${roleCode}`,
        status: UserStatus.ACTIVE
      }
    });
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: {
        code: roleCode,
        name: roleCode,
        isSystem: true
      }
    });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id
      }
    });

    return user;
  }

  async function ensureReportPermission() {
    const permission = await prisma.permission.upsert({
      where: { code: "report.read" },
      update: {},
      create: {
        code: "report.read",
        module: "report",
        description: "Read reports."
      }
    });

    for (const roleCode of ["super_admin", "clinic_admin", "doctor"]) {
      const role = await prisma.role.upsert({
        where: { code: roleCode },
        update: {},
        create: {
          code: roleCode,
          name: roleCode,
          isSystem: true
        }
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }
});
