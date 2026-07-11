import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  NotificationChannel,
  PaymentMode,
  ScopeType,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ReviewModule } from "../src/reviews/review.module.js";
import { ReviewService } from "../src/reviews/review.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";

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
    sessionId: "review-test-session"
  };
}

describeDatabase("reviews integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, ReviewModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewService);
    await ensureReviewModerationPermission();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("allows a patient to review a completed appointment and recalculates summary", async () => {
    const fixture = await createReviewFixture("review-completed", AppointmentStatus.COMPLETED);

    const response = await reviews.createPatientReview(
      fixture.patientActor,
      fixture.appointmentId,
      { rating: 5, comment: "Clear explanation." },
      context
    );
    const summary = await prisma.doctorRatingSummary.findUniqueOrThrow({
      where: { doctorId: fixture.doctorId }
    });

    expect(response.review.rating).toBe(5);
    expect(response.review.status).toBe("approved");
    expect(summary.reviewCount).toBe(1);
    expect(Number(summary.averageRating)).toBe(5);
  });

  it("rejects non-completed appointments, other patients, and duplicate reviews", async () => {
    const fixture = await createReviewFixture("review-rules", AppointmentStatus.CONFIRMED);
    const otherPatient = await createPatient("review-rules-other");

    await expect(
      reviews.createPatientReview(
        fixture.patientActor,
        fixture.appointmentId,
        { rating: 5 },
        context
      )
    ).rejects.toThrow("Appointment must be completed before review");

    await expect(
      reviews.createPatientReview(otherPatient.actor, fixture.appointmentId, { rating: 5 }, context)
    ).rejects.toThrow("Appointment not found");

    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() }
    });
    await reviews.createPatientReview(
      fixture.patientActor,
      fixture.appointmentId,
      { rating: 4 },
      context
    );

    await expect(
      reviews.createPatientReview(
        fixture.patientActor,
        fixture.appointmentId,
        { rating: 3 },
        context
      )
    ).rejects.toThrow("Review already exists");
  });

  it("updates and hides reviews while recalculating public rating summaries", async () => {
    const first = await createReviewFixture("review-summary-first", AppointmentStatus.COMPLETED);
    const second = await createReviewFixture("review-summary-second", AppointmentStatus.COMPLETED, {
      doctorId: first.doctorId,
      doctorUserId: first.doctorUserId,
      startOffsetMinutes: 60
    });
    const created = await reviews.createPatientReview(
      first.patientActor,
      first.appointmentId,
      { rating: 5 },
      context
    );
    await reviews.createPatientReview(second.patientActor, second.appointmentId, { rating: 1 }, context);

    let summary = await reviews.getPublicDoctorRatingSummary(first.doctorId);
    expect(summary.averageRating).toBe(3);
    expect(summary.distribution.rating1Count).toBe(1);
    expect(summary.distribution.rating5Count).toBe(1);

    await reviews.updatePatientReview(
      first.patientActor,
      created.review.id,
      { rating: 3 },
      context
    );
    summary = await reviews.getPublicDoctorRatingSummary(first.doctorId);
    expect(summary.averageRating).toBe(2);

    await reviews.deletePatientReview(first.patientActor, created.review.id, context);
    summary = await reviews.getPublicDoctorRatingSummary(first.doctorId);
    const publicReviews = await reviews.listPublicDoctorReviews(first.doctorId, { limit: 10 });

    expect(summary.averageRating).toBe(1);
    expect(summary.reviewCount).toBe(1);
    expect(publicReviews.reviews).toHaveLength(1);
    expect(publicReviews.reviews[0]).not.toHaveProperty("patientEmail");
  });

  it("requires platform moderation permission and hides moderated reviews", async () => {
    const fixture = await createReviewFixture("review-moderation", AppointmentStatus.COMPLETED);
    const clinicAdmin = await createRoleUser("review-moderation-clinic-admin", "clinic_admin");
    const superAdmin = await createRoleUser("review-moderation-super-admin", "super_admin");
    const created = await reviews.createPatientReview(
      fixture.patientActor,
      fixture.appointmentId,
      { rating: 5 },
      context
    );

    await expect(
      reviews.moderateReview(
        clinicAdmin.actor,
        created.review.id,
        { status: "hidden", reason: "Needs moderation" },
        context
      )
    ).rejects.toThrow("Missing required permission");

    const moderated = await reviews.moderateReview(
      superAdmin.actor,
      created.review.id,
      { status: "hidden", reason: "Contains personal information" },
      context
    );
    const publicReviews = await reviews.listPublicDoctorReviews(fixture.doctorId, { limit: 10 });

    expect(moderated.review.status).toBe("hidden");
    expect(publicReviews.reviews).toHaveLength(0);
  });

  it("sends review invitation notification only once per completed appointment", async () => {
    const fixture = await createReviewFixture("review-invitation", AppointmentStatus.COMPLETED);
    await ensureReviewInvitationTemplate();

    await reviews.enqueueReviewInvitation(fixture.appointmentId);
    await reviews.enqueueReviewInvitation(fixture.appointmentId);
    const count = await prisma.notificationLog.count({
      where: {
        appointmentId: fixture.appointmentId,
        eventCode: "review.invitation"
      }
    });

    expect(count).toBe(1);
  });

  async function createReviewFixture(
    prefix: string,
    status: AppointmentStatus,
    options: { doctorId?: string; doctorUserId?: string; startOffsetMinutes?: number } = {}
  ) {
    const patient = await createPatient(prefix);
    const doctorUser =
      options.doctorUserId
        ? await prisma.user.findUniqueOrThrow({ where: { id: options.doctorUserId } })
        : await prisma.user.create({
            data: {
              email: uniqueEmail(`${prefix}-doctor`),
              fullName: "Review Test Doctor",
              status: UserStatus.ACTIVE
            }
          });
    const doctor =
      options.doctorId
        ? await prisma.doctor.findUniqueOrThrow({ where: { id: options.doctorId } })
        : await prisma.doctor.create({
            data: {
              userId: doctorUser.id,
              slug: uniqueSlug(`${prefix}-doctor`),
              licenseNumber: `SLMC-${randomUUID()}`,
              status: DoctorStatus.APPROVED
            }
          });
    const clinic = await prisma.clinic.create({
      data: {
        name: "Review Test Clinic",
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE
      }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "1 Review Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const clinicService = await createClinicService(prefix, clinic.id);
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: location.id,
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
        isActive: true
      }
    });
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() - 1);
    startsAt.setUTCHours(4, 30, 0, 0);
    startsAt.setUTCMinutes(startsAt.getUTCMinutes() + (options.startOffsetMinutes ?? 0));
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.patientId,
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: location.id,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt,
        endsAt,
        status,
        completedAt: status === AppointmentStatus.COMPLETED ? new Date() : null,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Review Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.patientId,
        attendingNameSnapshot: "Review Test Patient",
        createdByUserId: patient.actor.id
      }
    });

    return {
      patientActor: patient.actor,
      patientId: patient.patientId,
      doctorId: doctor.id,
      doctorUserId: doctorUser.id,
      appointmentId: appointment.id
    };
  }

  async function createClinicService(prefix: string, clinicId: string) {
    const service = await prisma.service.create({
      data: {
        name: `Review Consultation ${prefix}`,
        slug: uniqueSlug(`${prefix}-service`),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });

    return prisma.clinicService.create({
      data: {
        clinicId,
        serviceId: service.id,
        isActive: true
      }
    });
  }

  async function createPatient(prefix: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Review Test Patient",
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

  async function createRoleUser(prefix: string, roleCode: "super_admin" | "clinic_admin") {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Review Moderator",
        status: UserStatus.ACTIVE
      }
    });
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode }
    });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id
      }
    });

    return {
      actor: asUser(user.id, [roleCode])
    };
  }

  async function ensureReviewModerationPermission() {
    const permission = await prisma.permission.upsert({
      where: { code: "review.moderate" },
      update: {},
      create: {
        code: "review.moderate",
        module: "review",
        description: "Moderate reviews."
      }
    });

    for (const roleCode of ["super_admin", "clinic_admin"]) {
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

  async function ensureReviewInvitationTemplate() {
    const result = await prisma.notificationTemplate.updateMany({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode: "review.invitation",
        channel: NotificationChannel.EMAIL,
        locale: "en"
      },
      data: {
        subject: "Review appointment",
        body: "Please review {{appointment.number}}",
        isActive: true
      }
    });

    if (result.count === 0) {
      await prisma.notificationTemplate.create({
        data: {
          scopeType: ScopeType.PLATFORM,
          scopeId: null,
          eventCode: "review.invitation",
          channel: NotificationChannel.EMAIL,
          locale: "en",
          subject: "Review appointment",
          body: "Please review {{appointment.number}}"
        }
      });
    }
  }
});
