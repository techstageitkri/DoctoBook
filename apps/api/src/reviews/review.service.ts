import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AppointmentStatus, Prisma, ReviewStatus } from "@doctobook/database";
import { createLogger } from "@doctobook/observability";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import {
  CreateReviewInput,
  ListAdminReviewsQuery,
  ListPublicReviewsQuery,
  ModerateReviewInput,
  UpdateReviewInput
} from "./review.schemas.js";

const publicReviewStatus = ReviewStatus.APPROVED;
const hiddenReviewStatuses: ReviewStatus[] = [ReviewStatus.HIDDEN, ReviewStatus.REJECTED];

@Injectable()
export class ReviewService {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly notificationService: NotificationService
  ) {}

  async getPatientAppointmentReview(actor: AuthenticatedUser, appointmentId: string) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      include: {
        review: true
      }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return {
      appointmentId,
      canReview: this.isAppointmentReviewEligible(appointment),
      eligibilityReason: this.reviewEligibilityReason(appointment),
      review: appointment.review ? this.serializePatientReview(appointment.review) : null
    };
  }

  async createPatientReview(
    actor: AuthenticatedUser,
    appointmentId: string,
    input: CreateReviewInput,
    context: RequestContext
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const result = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          patientId: patient.id
        },
        include: {
          review: true
        }
      });

      if (!appointment) {
        throw new NotFoundException("Appointment not found");
      }

      this.assertAppointmentReviewEligible(appointment);

      if (appointment.review) {
        throw new ConflictException("Review already exists for this appointment");
      }

      const review = await tx.review.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          clinicId: appointment.clinicId,
          rating: input.rating,
          title: input.title ?? null,
          comment: input.comment ?? null,
          status: ReviewStatus.APPROVED
        }
      });
      await this.recalculateDoctorRatingSummary(tx, appointment.doctorId);
      await this.writeAudit(tx, actor, "review.submit", review, context, {
        appointmentId: appointment.id,
        rating: review.rating
      });

      return review;
    });
    await this.safeNotify(() =>
      this.notificationService.enqueueAppointmentEvent(appointmentId, "review.submitted", {
        audiences: ["doctor"],
        variables: {
          review: {
            id: result.id,
            rating: result.rating
          }
        },
        idempotencyKeySuffix: result.id
      })
    );

    return {
      review: this.serializePatientReview(result)
    };
  }

  async updatePatientReview(
    actor: AuthenticatedUser,
    reviewId: string,
    input: UpdateReviewInput,
    context: RequestContext
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const review = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.review.findUnique({
        where: { id: reviewId }
      });

      if (!existing || existing.patientId !== patient.id) {
        throw new NotFoundException("Review not found");
      }

      if (hiddenReviewStatuses.includes(existing.status)) {
        throw new ConflictException("Review cannot be edited");
      }

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          ...(input.rating !== undefined ? { rating: input.rating } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          status: ReviewStatus.APPROVED,
          moderationReason: null,
          moderatedAt: null,
          moderatorUserId: null
        }
      });
      await this.recalculateDoctorRatingSummary(tx, existing.doctorId);
      await this.writeAudit(tx, actor, "review.update", updated, context, {
        previousStatus: existing.status,
        rating: updated.rating
      });

      return updated;
    });

    return {
      review: this.serializePatientReview(review)
    };
  }

  async deletePatientReview(actor: AuthenticatedUser, reviewId: string, context: RequestContext) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const review = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.review.findUnique({
        where: { id: reviewId }
      });

      if (!existing || existing.patientId !== patient.id) {
        throw new NotFoundException("Review not found");
      }

      if (existing.status === ReviewStatus.HIDDEN) {
        return existing;
      }

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          status: ReviewStatus.HIDDEN,
          moderationReason: "Removed by patient",
          moderatedAt: new Date()
        }
      });
      await this.recalculateDoctorRatingSummary(tx, existing.doctorId);
      await this.writeAudit(tx, actor, "review.delete", updated, context, {
        previousStatus: existing.status
      });

      return updated;
    });

    return {
      review: this.serializePatientReview(review)
    };
  }

  async listPublicDoctorReviews(doctorId: string, query: ListPublicReviewsQuery) {
    const reviews = await this.prisma.review.findMany({
      where: {
        doctorId,
        status: publicReviewStatus,
        appointment: {
          status: AppointmentStatus.COMPLETED
        }
      },
      orderBy: [{ createdAt: "desc" }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: this.publicReviewInclude()
    });

    return {
      reviews: reviews.map((review) => this.serializePublicReview(review)),
      nextCursor: reviews.length === query.limit ? reviews[reviews.length - 1]?.id ?? null : null
    };
  }

  async getPublicDoctorRatingSummary(doctorId: string) {
    const summary = await this.prisma.doctorRatingSummary.findUnique({
      where: { doctorId }
    });
    const distribution = await this.getRatingDistribution(doctorId);

    return {
      doctorId,
      averageRating: summary ? Number(summary.averageRating) : 0,
      reviewCount: summary?.reviewCount ?? 0,
      distribution
    };
  }

  async listAdminReviews(actor: AuthenticatedUser, query: ListAdminReviewsQuery) {
    await this.assertCan(actor, "review.moderate", "platform", null);
    const reviews = await this.prisma.review.findMany({
      where: {
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.clinicId ? { clinicId: query.clinicId } : {}),
        ...(query.status ? { status: this.toReviewStatus(query.status) } : {}),
        ...(query.rating ? { rating: query.rating } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: this.adminReviewInclude()
    });

    return {
      reviews: reviews.map((review) => this.serializeAdminReview(review))
    };
  }

  async getAdminReview(actor: AuthenticatedUser, reviewId: string) {
    await this.assertCan(actor, "review.moderate", "platform", null);
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: this.adminReviewInclude()
    });

    if (!review) {
      throw new NotFoundException("Review not found");
    }

    return {
      review: this.serializeAdminReview(review)
    };
  }

  async moderateReview(
    actor: AuthenticatedUser,
    reviewId: string,
    input: ModerateReviewInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "review.moderate", "platform", null);
    const nextStatus = this.toReviewStatus(input.status);
    const review = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.review.findUnique({
        where: { id: reviewId }
      });

      if (!existing) {
        throw new NotFoundException("Review not found");
      }

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          status: nextStatus,
          moderationReason: input.reason ?? null,
          moderatorUserId: actor.id,
          moderatedAt: new Date()
        }
      });
      await this.recalculateDoctorRatingSummary(tx, existing.doctorId);
      await this.writeAudit(tx, actor, "review.moderate", updated, context, {
        previousStatus: existing.status,
        nextStatus,
        reason: input.reason ?? null
      });

      return updated;
    });

    if (review.status === ReviewStatus.HIDDEN || review.status === ReviewStatus.REJECTED) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: review.patientId },
        select: { userId: true }
      });

      await this.safeNotify(() =>
        patient
          ? this.notificationService.enqueueUserEvent({
              eventCode: "review.moderated",
              userId: patient.userId,
              variables: {
                review: {
                  id: review.id,
                  status: review.status.toLowerCase(),
                  moderationReason: review.moderationReason ?? ""
                }
              },
              idempotencyKeySuffix: `${review.id}|${review.status}|${review.moderatedAt?.toISOString()}`
            })
          : Promise.resolve()
      );
    }

    return {
      review: this.serializePatientReview(review)
    };
  }

  async enqueueReviewInvitation(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        startsAt: true
      }
    });

    if (!appointment || !this.isAppointmentReviewEligible(appointment)) {
      return { queued: false };
    }

    await this.notificationService.enqueueAppointmentEvent(appointmentId, "review.invitation", {
      audiences: ["patient"],
      idempotencyKeySuffix: `review-invitation:${appointmentId}`
    });

    return { queued: true };
  }

  private assertPatientActor(actor: AuthenticatedUser) {
    if (!actor.roles.includes("patient")) {
      throw new ForbiddenException("Patient account is required");
    }
  }

  private async getPatientForActor(userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { userId }
    });

    if (!patient) {
      throw new ForbiddenException("Patient profile is required");
    }

    return patient;
  }

  private assertAppointmentReviewEligible(
    appointment: Pick<ReviewAppointmentRecord, "status" | "startsAt">
  ) {
    if (!this.isAppointmentReviewEligible(appointment)) {
      throw new ConflictException(this.reviewEligibilityReason(appointment));
    }
  }

  private isAppointmentReviewEligible(
    appointment: Pick<ReviewAppointmentRecord, "status" | "startsAt">
  ) {
    return appointment.status === AppointmentStatus.COMPLETED && appointment.startsAt <= new Date();
  }

  private reviewEligibilityReason(appointment: Pick<ReviewAppointmentRecord, "status" | "startsAt">) {
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      return "Appointment must be completed before review";
    }

    if (appointment.startsAt > new Date()) {
      return "Future appointments cannot be reviewed";
    }

    return null;
  }

  private async recalculateDoctorRatingSummary(
    tx: Prisma.TransactionClient,
    doctorId: string
  ) {
    const aggregate = await tx.review.aggregate({
      where: {
        doctorId,
        status: ReviewStatus.APPROVED
      },
      _avg: { rating: true },
      _count: { _all: true }
    });
    const average = aggregate._avg.rating ?? 0;
    const reviewCount = aggregate._count._all;

    await tx.doctorRatingSummary.upsert({
      where: { doctorId },
      update: {
        averageRating: new Prisma.Decimal(average.toFixed(2)),
        reviewCount
      },
      create: {
        doctorId,
        averageRating: new Prisma.Decimal(average.toFixed(2)),
        reviewCount
      }
    });
  }

  private async getRatingDistribution(doctorId: string) {
    const grouped = await this.prisma.review.groupBy({
      by: ["rating"],
      where: {
        doctorId,
        status: ReviewStatus.APPROVED
      },
      _count: { _all: true }
    });
    const distribution = {
      rating1Count: 0,
      rating2Count: 0,
      rating3Count: 0,
      rating4Count: 0,
      rating5Count: 0
    };

    for (const entry of grouped) {
      distribution[`rating${entry.rating}Count` as keyof typeof distribution] = entry._count._all;
    }

    return distribution;
  }

  private publicReviewInclude() {
    return {
      patient: {
        include: {
          user: {
            select: { fullName: true }
          }
        }
      },
      clinic: {
        select: { name: true }
      },
      appointment: {
        select: {
          clinicLocation: {
            select: {
              name: true,
              city: true
            }
          }
        }
      }
    } satisfies Prisma.ReviewInclude;
  }

  private adminReviewInclude() {
    return {
      patient: {
        include: {
          user: {
            select: { fullName: true, email: true, phone: true }
          }
        }
      },
      doctor: {
        include: {
          user: {
            select: { fullName: true }
          }
        }
      },
      clinic: {
        select: { name: true }
      },
      appointment: {
        select: {
          appointmentNumber: true,
          startsAt: true
        }
      }
    } satisfies Prisma.ReviewInclude;
  }

  private serializePatientReview(review: ReviewRecord) {
    return {
      id: review.id,
      appointmentId: review.appointmentId,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      status: review.status.toLowerCase(),
      moderationReason: review.moderationReason,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString()
    };
  }

  private serializePublicReview(review: PublicReviewRecord) {
    return {
      id: review.id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      patientDisplayName: this.anonymizeName(review.patient.user.fullName),
      patientLabel: "Verified patient",
      clinicName: review.clinic.name,
      clinicLocationName: review.appointment.clinicLocation.name,
      clinicCity: review.appointment.clinicLocation.city,
      createdAt: review.createdAt.toISOString()
    };
  }

  private serializeAdminReview(review: AdminReviewRecord) {
    return {
      id: review.id,
      appointmentNumber: review.appointment.appointmentNumber,
      appointmentStartsAt: review.appointment.startsAt.toISOString(),
      patientName: review.patient.user.fullName,
      patientEmail: review.patient.user.email,
      patientPhone: review.patient.user.phone,
      doctorName: review.doctor.user.fullName,
      clinicName: review.clinic.name,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      status: review.status.toLowerCase(),
      moderationReason: review.moderationReason,
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString()
    };
  }

  private anonymizeName(fullName: string) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return "Verified patient";
    }

    const first = parts[0] ?? "Patient";
    const lastInitial = parts[1]?.[0]?.toUpperCase();

    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private toReviewStatus(status: string) {
    const normalized = status.toUpperCase() as keyof typeof ReviewStatus;
    const value = ReviewStatus[normalized];

    if (!value) {
      throw new BadRequestException("Invalid review status");
    }

    return value;
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: Parameters<AuthorizationService["can"]>[2]["scope"],
    scopeId: string | null
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, { scope, scopeId });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    actionCode: string,
    review: ReviewRecord,
    context: RequestContext,
    metadata: Record<string, unknown>
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode,
        entityType: "review",
        entityId: review.id,
        clinicId: review.clinicId,
        patientId: review.patientId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: this.toJson(metadata) as Prisma.InputJsonValue
      }
    });
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      this.logger.error("notification.enqueue_failed", {}, error);
    }
  }

  private toJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

type ReviewRecord = Prisma.ReviewGetPayload<Record<string, never>>;

type ReviewAppointmentRecord = Prisma.AppointmentGetPayload<{
  include: {
    review: true;
  };
}>;

type PublicReviewRecord = Prisma.ReviewGetPayload<{
  include: ReturnType<ReviewService["publicReviewInclude"]>;
}>;

type AdminReviewRecord = Prisma.ReviewGetPayload<{
  include: ReturnType<ReviewService["adminReviewInclude"]>;
}>;
