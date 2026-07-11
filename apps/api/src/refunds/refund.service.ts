import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { PaymentStatus, Prisma, RefundStatus } from "@doctobook/database";
import { RefundQueueService } from "../appointments/refund-queue.service.js";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import {
  ListRefundsQuery,
  MarkManualRefundInput,
  MarkRefundReconciliationInput
} from "./refund.schemas.js";

const refundDetailInclude = Prisma.validator<Prisma.RefundInclude>()({
  appointment: {
    include: {
      clinic: {
        select: {
          id: true,
          name: true
        }
      },
      clinicLocation: {
        select: {
          id: true,
          name: true,
          city: true,
          timezone: true
        }
      },
      patient: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true
            }
          }
        }
      },
      doctor: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true
            }
          }
        }
      }
    }
  },
  payment: true,
  requestedBy: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  reviewedBy: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  reconciliationAssignedTo: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  statusHistory: {
    orderBy: {
      createdAt: "desc"
    },
    take: 25,
    include: {
      actor: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  }
});

const lockedRefundInclude = Prisma.validator<Prisma.RefundInclude>()({
  payment: true,
  appointment: {
    select: {
      id: true,
      appointmentNumber: true,
      clinicId: true,
      patientId: true
    }
  }
});

type RefundWithDetails = Prisma.RefundGetPayload<{ include: typeof refundDetailInclude }>;
type LockedRefund = Prisma.RefundGetPayload<{ include: typeof lockedRefundInclude }>;

const retryableStatuses: RefundStatus[] = [
  RefundStatus.FAILED,
  RefundStatus.RECONCILIATION_REQUIRED
];
const alreadyQueuedStatuses: RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING
];
const refundBalanceStatuses: RefundStatus[] = [
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
  RefundStatus.PROCESSED
];
const reconciliationAllowedStatuses: RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.UNDER_REVIEW,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
  RefundStatus.FAILED,
  RefundStatus.RECONCILIATION_REQUIRED
];

@Injectable()
export class RefundRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly refundQueue: RefundQueueService,
    private readonly notificationService: NotificationService
  ) {}

  async listAdminRefunds(actor: AuthenticatedUser, query: ListRefundsQuery) {
    await this.assertCan(actor, "payment.read", "platform", null);

    const refunds = await this.prisma.refund.findMany({
      where: this.buildRefundWhere(query),
      include: refundDetailInclude,
      orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
      take: query.limit
    });

    return {
      refunds: refunds.map((refund) => this.serializeRefund(refund))
    };
  }

  async getAdminRefund(actor: AuthenticatedUser, refundId: string) {
    await this.assertCan(actor, "payment.read", "platform", null);
    const refund = await this.findRefundOrThrow(refundId);

    return {
      refund: this.serializeRefund(refund, { includeHistory: true })
    };
  }

  async listClinicRefunds(actor: AuthenticatedUser, clinicId: string, query: ListRefundsQuery) {
    await this.assertCan(actor, "payment.read", "clinic", clinicId);

    const refunds = await this.prisma.refund.findMany({
      where: this.buildRefundWhere(query, clinicId),
      include: refundDetailInclude,
      orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
      take: query.limit
    });

    return {
      refunds: refunds.map((refund) => this.serializeRefund(refund))
    };
  }

  async getClinicRefund(actor: AuthenticatedUser, clinicId: string, refundId: string) {
    await this.assertCan(actor, "payment.read", "clinic", clinicId);
    const refund = await this.findRefundOrThrow(refundId);

    if (refund.appointment.clinicId !== clinicId) {
      throw new NotFoundException("Refund not found");
    }

    return {
      refund: this.serializeRefund(refund, { includeHistory: true })
    };
  }

  async retryRefund(actor: AuthenticatedUser, refundId: string, context: RequestContext = {}) {
    await this.assertCan(actor, "refund.process", "platform", null);

    const result = await this.prisma.$transaction(async (tx) => {
      const refund = await this.lockRefundWithPayment(tx, refundId);

      if (alreadyQueuedStatuses.includes(refund.status)) {
        return {
          refund: await this.findRefundOrThrow(refund.id, tx),
          duplicate: true,
          shouldEnqueue: true
        };
      }

      if (!retryableStatuses.includes(refund.status)) {
        throw new ConflictException("Refund cannot be retried from its current status");
      }

      await this.assertRefundableBalance(tx, refund);

      const now = new Date();
      const previousStatus = refund.status;
      const resolvesReconciliation = previousStatus === RefundStatus.RECONCILIATION_REQUIRED;

      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.REQUESTED,
          retryCount: { increment: 1 },
          reviewedByUserId: actor.id,
          reviewedAt: now,
          lastVerificationAt: now,
          resolvedAt: resolvesReconciliation ? now : null,
          resolutionAction: "retry_requested",
          providerStatus: "retry_requested",
          processedAt: null
        }
      });
      await tx.refundStatusHistory.create({
        data: {
          refundId: refund.id,
          fromStatus: previousStatus,
          toStatus: RefundStatus.REQUESTED,
          actorUserId: actor.id,
          reason: "Admin retry requested",
          metadata: this.toJson({
            retryCount: refund.retryCount + 1,
            paymentId: refund.paymentId
          })
        }
      });
      await this.createAuditLog(tx, actor, context, {
        actionCode: "refund.retry",
        refund,
        beforeData: {
          status: previousStatus,
          retryCount: refund.retryCount
        },
        afterData: {
          status: RefundStatus.REQUESTED,
          retryCount: refund.retryCount + 1
        },
        metadata: {
          paymentId: refund.paymentId
        }
      });

      return {
        refund: await this.findRefundOrThrow(refund.id, tx),
        duplicate: false,
        shouldEnqueue: true
      };
    });

    if (result.shouldEnqueue) {
      await this.refundQueue.enqueueRefundProcessing({ refundId });
    }

    return {
      queued: result.shouldEnqueue,
      duplicate: result.duplicate,
      refund: this.serializeRefund(result.refund, { includeHistory: true })
    };
  }

  async markRefundManual(
    actor: AuthenticatedUser,
    refundId: string,
    input: MarkManualRefundInput,
    context: RequestContext = {}
  ) {
    await this.assertCan(actor, "refund.process", "platform", null);

    if (!input.providerReference.trim() || !input.reason.trim()) {
      throw new BadRequestException("Provider reference and reason are required");
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      const lockedRefund = await this.lockRefundWithPayment(tx, refundId);

      if (lockedRefund.status === RefundStatus.PROCESSED) {
        throw new ConflictException("Refund has already been completed");
      }

      await this.assertRefundableBalance(tx, lockedRefund);

      const now = new Date();
      const processedAt = input.refundedAt ? new Date(input.refundedAt) : now;
      await tx.refund.update({
        where: { id: lockedRefund.id },
        data: {
          status: RefundStatus.PROCESSED,
          providerRefundId: input.providerReference,
          providerStatus: "manual_completed",
          providerResponse: this.toJson({
            manual: true,
            providerReference: input.providerReference,
            reason: input.reason,
            refundedAt: processedAt.toISOString()
          }),
          reviewedByUserId: actor.id,
          reviewedAt: now,
          processedAt,
          lastVerificationAt: now,
          resolvedAt: now,
          resolutionAction: "manual_completed",
          adminNotes: input.reason
        }
      });
      await tx.refundStatusHistory.create({
        data: {
          refundId: lockedRefund.id,
          fromStatus: lockedRefund.status,
          toStatus: RefundStatus.PROCESSED,
          actorUserId: actor.id,
          reason: input.reason,
          metadata: this.toJson({
            manual: true,
            providerReference: input.providerReference,
            refundedAt: processedAt.toISOString()
          })
        }
      });
      await this.createAuditLog(tx, actor, context, {
        actionCode: "refund.manual_complete",
        refund: lockedRefund,
        beforeData: {
          status: lockedRefund.status,
          providerRefundId: lockedRefund.providerRefundId
        },
        afterData: {
          status: RefundStatus.PROCESSED,
          providerRefundId: input.providerReference,
          processedAt: processedAt.toISOString()
        },
        metadata: {
          reason: input.reason,
          paymentId: lockedRefund.paymentId
        }
      });

      return this.findRefundOrThrow(lockedRefund.id, tx);
    });

    const notification = await this.notificationService.enqueueRefundEvent(refund.id, "refund.completed");

    return {
      notification,
      refund: this.serializeRefund(refund, { includeHistory: true })
    };
  }

  async markRefundReconciliation(
    actor: AuthenticatedUser,
    refundId: string,
    input: MarkRefundReconciliationInput,
    context: RequestContext = {}
  ) {
    await this.assertCan(actor, "refund.process", "platform", null);

    if (!input.reason.trim()) {
      throw new BadRequestException("Reconciliation reason is required");
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      const lockedRefund = await this.lockRefundWithPayment(tx, refundId);

      if (!reconciliationAllowedStatuses.includes(lockedRefund.status)) {
        throw new ConflictException("Refund cannot be moved to reconciliation from its current status");
      }

      const now = new Date();
      await tx.refund.update({
        where: { id: lockedRefund.id },
        data: {
          status: RefundStatus.RECONCILIATION_REQUIRED,
          providerStatus: "reconciliation_required",
          ...(input.providerResponse !== undefined
            ? { providerResponse: this.toJson(input.providerResponse) }
            : {}),
          reconciliationReason: input.reason,
          reconciliationNotes: input.notes?.trim() || null,
          reconciliationAssignedToUserId: actor.id,
          reviewedByUserId: actor.id,
          reviewedAt: now,
          lastVerificationAt: now,
          resolvedAt: null,
          resolutionAction: null,
          adminNotes: input.notes?.trim() || input.reason
        }
      });
      await tx.refundStatusHistory.create({
        data: {
          refundId: lockedRefund.id,
          fromStatus: lockedRefund.status,
          toStatus: RefundStatus.RECONCILIATION_REQUIRED,
          actorUserId: actor.id,
          reason: input.reason,
          metadata: this.toJson({
            notes: input.notes ?? null,
            previousStatus: lockedRefund.status,
            providerResponseCaptured: input.providerResponse !== undefined
          })
        }
      });
      await this.createAuditLog(tx, actor, context, {
        actionCode: "refund.reconciliation_required",
        refund: lockedRefund,
        beforeData: {
          status: lockedRefund.status
        },
        afterData: {
          status: RefundStatus.RECONCILIATION_REQUIRED,
          reason: input.reason,
          notes: input.notes ?? null
        },
        metadata: {
          paymentId: lockedRefund.paymentId
        }
      });

      return this.findRefundOrThrow(lockedRefund.id, tx);
    });

    return {
      refund: this.serializeRefund(refund, { includeHistory: true })
    };
  }

  private async findRefundOrThrow(
    refundId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const refund = await client.refund.findUnique({
      where: { id: refundId },
      include: refundDetailInclude
    });

    if (!refund) {
      throw new NotFoundException("Refund not found");
    }

    return refund;
  }

  private async lockRefundWithPayment(tx: Prisma.TransactionClient, refundId: string) {
    const pointer = await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        paymentId: true
      }
    });

    if (!pointer) {
      throw new NotFoundException("Refund not found");
    }

    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "payments"
      WHERE "id" = CAST(${pointer.paymentId} AS uuid)
      FOR UPDATE
    `;
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "refunds"
      WHERE "id" = CAST(${refundId} AS uuid)
      FOR UPDATE
    `;

    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: lockedRefundInclude
    });

    if (!refund) {
      throw new NotFoundException("Refund not found");
    }

    return refund;
  }

  private async assertRefundableBalance(tx: Prisma.TransactionClient, refund: LockedRefund) {
    if (refund.payment.status !== PaymentStatus.SUCCESSFUL) {
      throw new ConflictException("Refund payment must be successful");
    }

    const totals = await tx.refund.aggregate({
      where: {
        paymentId: refund.paymentId,
        id: {
          not: refund.id
        },
        status: {
          in: refundBalanceStatuses
        }
      },
      _sum: {
        amountMinor: true
      }
    });
    const alreadyReserved = totals._sum.amountMinor ?? 0n;

    if (alreadyReserved + refund.amountMinor > refund.payment.amountMinor) {
      throw new ConflictException("Refund total exceeds successful payment amount");
    }
  }

  private buildRefundWhere(query: ListRefundsQuery, forcedClinicId?: string): Prisma.RefundWhereInput {
    const appointment: Prisma.AppointmentWhereInput = {};
    const requestedAt: Prisma.DateTimeFilter = {};
    const amountMinor: Prisma.BigIntFilter = {};

    if (forcedClinicId || query.clinicId) {
      appointment.clinicId = forcedClinicId ?? query.clinicId;
    }

    if (query.patientId) {
      appointment.patientId = query.patientId;
    }

    if (query.from) {
      requestedAt.gte = new Date(query.from);
    }

    if (query.to) {
      requestedAt.lte = new Date(query.to);
    }

    if (query.minimumAmount !== undefined) {
      amountMinor.gte = query.minimumAmount;
    }

    if (query.maximumAmount !== undefined) {
      amountMinor.lte = query.maximumAmount;
    }

    return {
      ...(query.status ? { status: this.toRefundStatus(query.status) } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.paymentId ? { paymentId: query.paymentId } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(Object.keys(requestedAt).length > 0 ? { requestedAt } : {}),
      ...(Object.keys(amountMinor).length > 0 ? { amountMinor } : {}),
      ...(Object.keys(appointment).length > 0 ? { appointment } : {})
    };
  }

  private toRefundStatus(status: NonNullable<ListRefundsQuery["status"]>) {
    return status.toUpperCase() as RefundStatus;
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: "platform" | "clinic",
    scopeId: string | null
  ) {
    const allowed = await this.authorization.can(actor, permissionCode, { scope, scopeId });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private async createAuditLog(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    context: RequestContext,
    input: {
      actionCode: string;
      refund: LockedRefund;
      beforeData?: Record<string, unknown>;
      afterData?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: input.actionCode,
        entityType: "refund",
        entityId: input.refund.id,
        clinicId: input.refund.appointment.clinicId,
        patientId: input.refund.appointment.patientId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        beforeData: input.beforeData ? this.toJson(input.beforeData) : undefined,
        afterData: input.afterData ? this.toJson(input.afterData) : undefined,
        metadata: this.toJson(input.metadata ?? {})
      }
    });
  }

  private serializeRefund(refund: RefundWithDetails, options: { includeHistory?: boolean } = {}) {
    return {
      id: refund.id,
      appointmentId: refund.appointmentId,
      appointmentNumber: refund.appointment.appointmentNumber,
      paymentId: refund.paymentId,
      patient: {
        id: refund.appointment.patientId,
        userId: refund.appointment.patient.userId,
        name: refund.appointment.patient.user.fullName,
        email: refund.appointment.patient.user.email,
        phone: refund.appointment.patient.user.phone
      },
      clinic: {
        id: refund.appointment.clinicId,
        name: refund.appointment.clinic.name
      },
      location: {
        id: refund.appointment.clinicLocationId,
        name: refund.appointment.clinicLocation.name,
        city: refund.appointment.clinicLocation.city,
        timezone: refund.appointment.clinicLocation.timezone
      },
      doctor: {
        id: refund.appointment.doctorId,
        name: refund.appointment.doctor.user.fullName
      },
      appointment: {
        id: refund.appointment.id,
        number: refund.appointment.appointmentNumber,
        status: refund.appointment.status.toLowerCase(),
        serviceName: refund.appointment.serviceNameSnapshot,
        startsAt: refund.appointment.startsAt.toISOString(),
        endsAt: refund.appointment.endsAt.toISOString(),
        feeMinor: refund.appointment.feeMinor.toString(),
        currency: refund.appointment.currency
      },
      payment: {
        id: refund.payment.id,
        provider: refund.payment.provider,
        providerPaymentId: refund.payment.providerPaymentId,
        amountMinor: refund.payment.amountMinor.toString(),
        currency: refund.payment.currency,
        status: refund.payment.status.toLowerCase(),
        paidAt: refund.payment.paidAt?.toISOString() ?? null
      },
      provider: refund.provider,
      providerRefundId: refund.providerRefundId,
      providerStatus: refund.providerStatus,
      providerResponse: this.redactJson(refund.providerResponse),
      amountMinor: refund.amountMinor.toString(),
      currency: refund.currency,
      status: refund.status.toLowerCase(),
      reason: refund.reason,
      failureReason: refund.status === RefundStatus.FAILED ? refund.adminNotes : null,
      adminNotes: refund.adminNotes,
      retryCount: refund.retryCount,
      reconciliation: {
        reason: refund.reconciliationReason,
        notes: refund.reconciliationNotes,
        assignedTo: refund.reconciliationAssignedTo
          ? {
              id: refund.reconciliationAssignedTo.id,
              name: refund.reconciliationAssignedTo.fullName,
              email: refund.reconciliationAssignedTo.email
            }
          : null,
        lastVerificationAt: refund.lastVerificationAt?.toISOString() ?? null,
        resolvedAt: refund.resolvedAt?.toISOString() ?? null,
        resolutionAction: refund.resolutionAction
      },
      requestedBy: {
        id: refund.requestedBy.id,
        name: refund.requestedBy.fullName,
        email: refund.requestedBy.email
      },
      reviewedBy: refund.reviewedBy
        ? {
            id: refund.reviewedBy.id,
            name: refund.reviewedBy.fullName,
            email: refund.reviewedBy.email
          }
        : null,
      requestedAt: refund.requestedAt.toISOString(),
      reviewedAt: refund.reviewedAt?.toISOString() ?? null,
      processedAt: refund.processedAt?.toISOString() ?? null,
      createdAt: refund.createdAt.toISOString(),
      updatedAt: refund.updatedAt.toISOString(),
      ...(options.includeHistory
        ? {
            statusHistory: refund.statusHistory.map((entry) => ({
              id: entry.id,
              fromStatus: entry.fromStatus?.toLowerCase() ?? null,
              toStatus: entry.toStatus.toLowerCase(),
              reason: entry.reason,
              metadata: this.redactJson(entry.metadata),
              createdAt: entry.createdAt.toISOString(),
              actor: entry.actor
                ? {
                    id: entry.actor.id,
                    name: entry.actor.fullName,
                    email: entry.actor.email
                  }
                : null
            }))
          }
        : {})
    };
  }

  private redactJson(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactJson(item));
    }

    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          this.isSensitiveKey(key) ? "[redacted]" : this.redactJson(nestedValue)
        ])
      );
    }

    return value;
  }

  private isSensitiveKey(key: string) {
    const normalized = key.toLowerCase();

    return [
      "authorization",
      "card",
      "cvv",
      "key",
      "merchantsecret",
      "password",
      "secret",
      "signature",
      "token"
    ].some((term) => normalized.includes(term));
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
