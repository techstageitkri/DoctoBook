import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RescheduleRequestStatus,
  ScopeType,
  SlotHoldStatus
} from "@doctobook/database";
import { createLogger } from "@doctobook/observability";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { parseGatewayResponse } from "@doctobook/payments";
import { NotificationService } from "../notifications/notification.service.js";
import {
  RescheduleAppointmentInput,
  RescheduleOptionsQuery
} from "./appointment-operations.schemas.js";
import { PaymentQueueService } from "./payment-queue.service.js";
import { RefundQueueService } from "./refund-queue.service.js";

const reschedulableStatuses: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.PENDING_PAYMENT
];

const blockingAppointmentStatuses = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED
];

const activeHoldStatuses = [SlotHoldStatus.ACTIVE];

@Injectable()
export class AppointmentRescheduleService {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentQueueService: PaymentQueueService,
    private readonly refundQueueService: RefundQueueService,
    private readonly notificationService: NotificationService
  ) {}

  async listPatientRescheduleOptions(
    actor: AuthenticatedUser,
    appointmentId: string,
    query: RescheduleOptionsQuery
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      include: {
        doctorClinicService: true
      }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    await this.assertReschedulePolicy(this.prisma, appointment, new Date());
    const range = this.resolveOptionRange(query);
    const slots = await this.prisma.appointmentSlot.findMany({
      where: {
        doctorClinicId: appointment.doctorClinicId,
        doctorClinicServiceId: appointment.doctorClinicServiceId,
        id: { not: appointment.slotId ?? undefined },
        isActive: true,
        startsAt: {
          gte: range.from,
          lt: range.to
        },
        appointments: {
          none: {
            status: { in: blockingAppointmentStatuses }
          }
        },
        holds: {
          none: {
            status: { in: activeHoldStatuses },
            expiresAt: { gt: new Date() }
          }
        }
      },
      include: this.slotInclude(),
      orderBy: { startsAt: "asc" },
      take: query.limit
    });
    const bookableSlots = slots.filter((slot) => this.isReplacementSlotBookable(slot, new Date()));

    return {
      appointmentId: appointment.id,
      currentAmountMinor: appointment.feeMinor.toString(),
      currency: appointment.currency,
      slots: bookableSlots.map((slot) => {
        const amountMinor = this.resolveSlotFee(slot);
        const priceDifferenceMinor = amountMinor - appointment.feeMinor;

        return {
          slotId: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          amountMinor: amountMinor.toString(),
          priceDifferenceMinor: priceDifferenceMinor.toString(),
          paymentRequired:
            priceDifferenceMinor > 0n &&
            appointment.paymentMode !== PaymentMode.PAY_AT_CLINIC
        };
      })
    };
  }

  async createPatientReschedule(
    actor: AuthenticatedUser,
    appointmentId: string,
    input: RescheduleAppointmentInput,
    idempotencyKey: string,
    context: RequestContext
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const requestHash = this.hashRescheduleRequest(input);
    const existing = await this.findIdempotentRequest(
      this.prisma,
      appointmentId,
      idempotencyKey
    );

    if (existing) {
      this.assertSameRequestHash(existing, requestHash);
      return this.serializeRescheduleResponse(existing, true);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lockAppointment(tx, appointmentId);
        const appointment = await this.getAppointmentForOperation(tx, appointmentId);

        if (appointment.patientId !== patient.id) {
          throw new NotFoundException("Appointment not found");
        }

        const existingInsideTransaction = await this.findIdempotentRequest(
          tx,
          appointmentId,
          idempotencyKey
        );

        if (existingInsideTransaction) {
          this.assertSameRequestHash(existingInsideTransaction, requestHash);
          return {
            request: existingInsideTransaction,
            paymentJob: null,
            refundJobs: []
          };
        }

        const now = await this.getDatabaseNow(tx);
        await this.assertReschedulePolicy(tx, appointment, now);
        await this.lockSlot(tx, input.replacementSlotId);
        const replacementSlot = await this.getLockedReplacementSlot(tx, input.replacementSlotId);

        this.assertReplacementSlotMatchesAppointment(appointment, replacementSlot, now);
        await this.resolveExpiredHoldsForSlot(tx, replacementSlot.id, now);
        await this.assertReplacementSlotFree(tx, replacementSlot.id, now);

        const newFeeMinor = this.resolveSlotFee(replacementSlot);
        const differenceFeeMinor = newFeeMinor - appointment.feeMinor;
        const request = await tx.appointmentRescheduleRequest.create({
          data: {
            appointmentId: appointment.id,
            requestedByUserId: actor.id,
            oldSlotId: appointment.slotId,
            newSlotId: replacementSlot.id,
            oldDoctorClinicServiceId: appointment.doctorClinicServiceId,
            newDoctorClinicServiceId: replacementSlot.doctorClinicServiceId,
            oldStartsAt: appointment.startsAt,
            oldEndsAt: appointment.endsAt,
            newStartsAt: replacementSlot.startsAt,
            newEndsAt: replacementSlot.endsAt,
            oldFeeMinor: appointment.feeMinor,
            newFeeMinor,
            differenceFeeMinor,
            currency: appointment.currency,
            status: RescheduleRequestStatus.REQUESTED,
            reason: input.reason ?? null,
            rescheduleIdempotencyKey: idempotencyKey,
            rescheduleRequestHash: requestHash
          }
        });

        if (differenceFeeMinor > 0n && this.requiresOnlineDifferencePayment(appointment)) {
          const holdExpiresAt = new Date(
            now.getTime() + (await this.getActiveHoldMinutes(tx)) * 60 * 1000
          );
          const parentPayment = this.getLatestSuccessfulPayment(appointment);

          await tx.appointmentSlotHold.create({
            data: {
              slotId: replacementSlot.id,
              userId: actor.id,
              rescheduleRequestId: request.id,
              idempotencyKey: this.createDerivedIdempotencyKey(
                "reschedule-hold",
                appointment.patientId,
                idempotencyKey
              ),
              status: SlotHoldStatus.ACTIVE,
              expiresAt: holdExpiresAt
            }
          });
          const payment = await tx.payment.create({
            data: {
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              provider: "pending_gateway",
              idempotencyKey: this.createDerivedIdempotencyKey(
                "reschedule-payment",
                appointment.patientId,
                idempotencyKey
              ),
              paymentPurpose: PaymentPurpose.RESCHEDULE_DIFFERENCE,
              parentPaymentId: parentPayment?.id ?? null,
              rescheduleRequestId: request.id,
              amountMinor: differenceFeeMinor,
              currency: appointment.currency,
              status: PaymentStatus.INITIATED
            }
          });

          await this.writeAudit(tx, actor, "appointment.reschedule.request", appointment, context, {
            requestId: request.id,
            replacementSlotId: replacementSlot.id,
            differenceFeeMinor: differenceFeeMinor.toString(),
            paymentId: payment.id,
            requiresPayment: true
          });

          return {
            request: await this.getRescheduleRequestForResponse(tx, request.id),
            paymentJob: { paymentId: payment.id, appointmentId: appointment.id },
            refundJobs: []
          };
        }

        const refundIds = await this.applyRescheduleImmediately(
          tx,
          actor,
          appointment,
          request.id,
          replacementSlot,
          newFeeMinor,
          differenceFeeMinor,
          context
        );

        return {
          request: await this.getRescheduleRequestForResponse(tx, request.id),
          paymentJob: null,
          refundJobs: refundIds
        };
      });

      if (result.paymentJob) {
        await this.paymentQueueService.enqueuePaymentInitiation(result.paymentJob);
        await this.safeNotify(() =>
          this.notificationService.enqueueAppointmentEvent(
            result.paymentJob!.appointmentId,
            "reschedule.payment_required",
            {
              audiences: ["patient"],
              variables: {
                reschedule: this.buildRescheduleVariables(result.request)
              },
              idempotencyKeySuffix: result.request.id
            }
          )
        );
      } else {
        await this.safeNotify(() =>
          this.notificationService.enqueueAppointmentEvent(
            result.request.appointmentId,
            "reschedule.completed",
            {
              audiences: ["patient", "doctor"],
              variables: {
                reschedule: this.buildRescheduleVariables(result.request)
              },
              idempotencyKeySuffix: result.request.id
            }
          )
        );
      }

      for (const refundId of result.refundJobs) {
        await this.refundQueueService.enqueueRefundProcessing({ refundId });
        await this.safeNotify(() =>
          this.notificationService.enqueueRefundEvent(refundId, "refund.requested")
        );
      }

      return this.serializeRescheduleResponse(result.request, false);
    } catch (error) {
      const existingAfterConflict = await this.tryResolveIdempotencyConflict(
        error,
        appointmentId,
        idempotencyKey,
        requestHash
      );

      if (existingAfterConflict) {
        return this.serializeRescheduleResponse(existingAfterConflict, true);
      }

      this.throwMappedDatabaseError(error);
      throw error;
    }
  }

  async getPatientRescheduleStatus(actor: AuthenticatedUser, appointmentId: string) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      select: { id: true }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    const requests = await this.prisma.appointmentRescheduleRequest.findMany({
      where: { appointmentId },
      include: this.rescheduleRequestInclude(),
      orderBy: { createdAt: "desc" },
      take: 10
    });
    const refunds = await this.prisma.refund.findMany({
      where: { appointmentId },
      orderBy: { requestedAt: "desc" },
      take: 10
    });

    return {
      appointmentId,
      rescheduleRequest: requests[0] ? this.serializeRescheduleRequest(requests[0]) : null,
      rescheduleRequests: requests.map((request) => this.serializeRescheduleRequest(request)),
      refunds: refunds.map((refund) => this.serializeRefund(refund))
    };
  }

  async cancelPatientReschedule(
    actor: AuthenticatedUser,
    appointmentId: string,
    context: RequestContext
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAppointment(tx, appointmentId);
      const appointment = await this.getAppointmentForOperation(tx, appointmentId);

      if (appointment.patientId !== patient.id) {
        throw new NotFoundException("Appointment not found");
      }

      const request = await tx.appointmentRescheduleRequest.findFirst({
        where: {
          appointmentId,
          status: RescheduleRequestStatus.REQUESTED
        },
        include: this.rescheduleRequestInclude(),
        orderBy: { createdAt: "desc" }
      });

      if (!request) {
        throw new NotFoundException("Active reschedule request not found");
      }

      const now = await this.getDatabaseNow(tx);
      await tx.appointmentSlotHold.updateMany({
        where: {
          rescheduleRequestId: request.id,
          status: SlotHoldStatus.ACTIVE
        },
        data: {
          status: SlotHoldStatus.CANCELLED,
          resolvedAt: now
        }
      });
      await tx.payment.updateMany({
        where: {
          rescheduleRequestId: request.id,
          status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] }
        },
        data: {
          status: PaymentStatus.CANCELLED
        }
      });
      await tx.appointmentRescheduleRequest.update({
        where: { id: request.id },
        data: {
          status: RescheduleRequestStatus.CANCELLED,
          resolvedAt: now
        }
      });
      await this.writeAudit(tx, actor, "appointment.reschedule.cancel", appointment, context, {
        requestId: request.id
      });

      return {
        appointmentId,
        rescheduleRequest: this.serializeRescheduleRequest(
          await this.getRescheduleRequestForResponse(tx, request.id)
        )
      };
    });
    await this.safeNotify(() =>
      this.notificationService.enqueueAppointmentEvent(appointmentId, "reschedule.cancelled", {
        audiences: ["patient"],
        variables: {
          reschedule: result.rescheduleRequest
        },
        idempotencyKeySuffix: result.rescheduleRequest.id
      })
    );

    return result;
  }

  private async applyRescheduleImmediately(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    appointment: AppointmentForOperation,
    requestId: string,
    replacementSlot: ReplacementSlot,
    newFeeMinor: bigint,
    differenceFeeMinor: bigint,
    context: RequestContext
  ) {
    const now = await this.getDatabaseNow(tx);
    await this.releaseOldAppointmentHolds(tx, appointment, now);
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        slotId: replacementSlot.id,
        startsAt: replacementSlot.startsAt,
        endsAt: replacementSlot.endsAt,
        doctorClinicServiceId: replacementSlot.doctorClinicServiceId,
        serviceNameSnapshot: this.resolveSlotServiceName(replacementSlot),
        serviceDurationMinutes: replacementSlot.doctorClinicService.durationMinutes,
        feeMinor: newFeeMinor,
        currency: replacementSlot.doctorClinicService.currency,
        updatedByUserId: actor.id
      }
    });
    await tx.appointmentRescheduleRequest.update({
      where: { id: requestId },
      data: {
        status: RescheduleRequestStatus.APPLIED,
        resolvedAt: now
      }
    });
    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appointment.id,
        fromStatus: appointment.status,
        toStatus: appointment.status,
        changedByUserId: actor.id,
        reason: "Appointment rescheduled",
        metadata: this.toJson({
          source: "appointment_reschedule",
          requestId,
          oldSlotId: appointment.slotId,
          newSlotId: replacementSlot.id,
          oldStartsAt: appointment.startsAt.toISOString(),
          newStartsAt: replacementSlot.startsAt.toISOString(),
          differenceFeeMinor: differenceFeeMinor.toString()
        }) as Prisma.InputJsonValue
      }
    });
    const refundIds =
      differenceFeeMinor < 0n
        ? await this.createDifferenceRefunds(tx, actor, appointment, -differenceFeeMinor)
        : [];

    await this.writeAudit(tx, actor, "appointment.reschedule.apply", appointment, context, {
      requestId,
      oldSlotId: appointment.slotId,
      newSlotId: replacementSlot.id,
      oldStartsAt: appointment.startsAt.toISOString(),
      newStartsAt: replacementSlot.startsAt.toISOString(),
      oldFeeMinor: appointment.feeMinor.toString(),
      newFeeMinor: newFeeMinor.toString(),
      refundIds
    });

    return refundIds;
  }

  private async createDifferenceRefunds(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    appointment: AppointmentForOperation,
    amountMinor: bigint
  ) {
    const payment = this.getLatestSuccessfulPayment(appointment);

    if (!payment || amountMinor <= 0n) {
      return [];
    }

    const refund = await tx.refund.create({
      data: {
        paymentId: payment.id,
        appointmentId: appointment.id,
        requestedByUserId: actor.id,
        provider: payment.provider,
        amountMinor,
        currency: payment.currency,
        status: RefundStatus.REQUESTED,
        reason: "Appointment reschedule price difference"
      }
    });
    await tx.refundStatusHistory.create({
      data: {
        refundId: refund.id,
        fromStatus: null,
        toStatus: RefundStatus.REQUESTED,
        actorUserId: actor.id,
        reason: refund.reason,
        metadata: this.toJson({
          source: "appointment_reschedule"
        }) as Prisma.InputJsonValue
      }
    });

    return [refund.id];
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

  private async assertReschedulePolicy(
    tx: PrismaExecutor,
    appointment: AppointmentForPolicy,
    now: Date
  ) {
    if (!reschedulableStatuses.includes(appointment.status)) {
      throw new ConflictException({
        code: "APPOINTMENT_NOT_RESCHEDULABLE",
        message: "Appointment cannot be rescheduled"
      });
    }

    const windowMinutes = await this.resolveRescheduleWindowMinutes(tx, appointment);
    const deadline = new Date(appointment.startsAt.getTime() - windowMinutes * 60 * 1000);

    if (now > deadline) {
      throw new ConflictException({
        code: "RESCHEDULE_WINDOW_CLOSED",
        message: "Appointment can no longer be rescheduled"
      });
    }

    const maxReschedules = appointment.doctorClinicService.maxReschedules ?? 3;
    const appliedCount = await tx.appointmentRescheduleRequest.count({
      where: {
        appointmentId: appointment.id,
        status: RescheduleRequestStatus.APPLIED
      }
    });

    if (appliedCount >= maxReschedules) {
      throw new ConflictException({
        code: "MAX_RESCHEDULES_REACHED",
        message: "Maximum reschedules reached"
      });
    }
  }

  private async resolveRescheduleWindowMinutes(
    tx: PrismaExecutor,
    appointment: AppointmentForPolicy
  ) {
    if (appointment.doctorClinicService.rescheduleWindowMinutes !== null) {
      return appointment.doctorClinicService.rescheduleWindowMinutes;
    }

    const setting = await tx.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.reschedule_window_minutes"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? Number(setting.value.value)
        : NaN;

    return Number.isFinite(value) && value >= 0 ? value : 30;
  }

  private resolveOptionRange(query: RescheduleOptionsQuery) {
    const from = query.fromDate ? new Date(`${query.fromDate}T00:00:00.000Z`) : new Date();
    const to = query.toDate
      ? new Date(`${query.toDate}T00:00:00.000Z`)
      : new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

    if (query.toDate) {
      to.setUTCDate(to.getUTCDate() + 1);
    }

    return { from, to };
  }

  private async lockAppointment(tx: Prisma.TransactionClient, appointmentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointments"
      WHERE "id" = CAST(${appointmentId} AS uuid)
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException("Appointment not found");
    }
  }

  private async lockSlot(tx: Prisma.TransactionClient, slotId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointment_slots"
      WHERE "id" = CAST(${slotId} AS uuid)
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException("Replacement slot not found");
    }
  }

  private async getAppointmentForOperation(tx: PrismaExecutor, appointmentId: string) {
    return tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: this.appointmentInclude()
    });
  }

  private async getLockedReplacementSlot(tx: Prisma.TransactionClient, slotId: string) {
    return tx.appointmentSlot.findUniqueOrThrow({
      where: { id: slotId },
      include: this.slotInclude()
    });
  }

  private appointmentInclude() {
    return {
      doctorClinicService: true,
      payments: {
        orderBy: { createdAt: "desc" }
      },
      refunds: true
    } satisfies Prisma.AppointmentInclude;
  }

  private slotInclude() {
    return {
      doctorClinic: {
        include: {
          clinic: true,
          clinicLocation: true,
          doctor: true
        }
      },
      doctorClinicService: {
        include: {
          clinicService: {
            include: {
              service: true
            }
          }
        }
      }
    } satisfies Prisma.AppointmentSlotInclude;
  }

  private assertReplacementSlotMatchesAppointment(
    appointment: AppointmentForOperation,
    slot: ReplacementSlot,
    now: Date
  ) {
    if (
      slot.doctorClinicId !== appointment.doctorClinicId ||
      slot.doctorClinicServiceId !== appointment.doctorClinicServiceId
    ) {
      throw new ConflictException({
        code: "REPLACEMENT_SLOT_MISMATCH",
        message: "Replacement slot must use the same doctor, clinic, location, and service"
      });
    }

    if (!this.isReplacementSlotBookable(slot, now)) {
      throw new ConflictException({
        code: "REPLACEMENT_SLOT_NOT_BOOKABLE",
        message: "Replacement slot is not available"
      });
    }
  }

  private isReplacementSlotBookable(slot: ReplacementSlot, now: Date) {
    return (
      slot.isActive &&
      slot.startsAt > now &&
      slot.doctorClinic.status === ClinicAssociationStatus.APPROVED &&
      !slot.doctorClinic.deletedAt &&
      slot.doctorClinic.clinic.status === ClinicStatus.ACTIVE &&
      !slot.doctorClinic.clinic.deletedAt &&
      slot.doctorClinic.clinicLocation.status === ClinicStatus.ACTIVE &&
      !slot.doctorClinic.clinicLocation.deletedAt &&
      slot.doctorClinic.doctor.status === DoctorStatus.APPROVED &&
      !slot.doctorClinic.doctor.deletedAt &&
      slot.doctorClinicService.isActive &&
      !slot.doctorClinicService.deletedAt &&
      slot.doctorClinicService.clinicService.isActive &&
      slot.doctorClinicService.clinicService.service.isActive
    );
  }

  private async resolveExpiredHoldsForSlot(
    tx: Prisma.TransactionClient,
    slotId: string,
    now: Date
  ) {
    await tx.appointmentSlotHold.updateMany({
      where: {
        slotId,
        status: SlotHoldStatus.ACTIVE,
        expiresAt: { lte: now }
      },
      data: {
        status: SlotHoldStatus.EXPIRED,
        resolvedAt: now
      }
    });
  }

  private async assertReplacementSlotFree(
    tx: Prisma.TransactionClient,
    slotId: string,
    now: Date
  ) {
    const [activeHold, activeAppointment] = await Promise.all([
      tx.appointmentSlotHold.findFirst({
        where: {
          slotId,
          status: SlotHoldStatus.ACTIVE,
          expiresAt: { gt: now }
        },
        select: { id: true }
      }),
      tx.appointment.findFirst({
        where: {
          slotId,
          status: { in: blockingAppointmentStatuses }
        },
        select: { id: true }
      })
    ]);

    if (activeHold) {
      throw new ConflictException({
        code: "REPLACEMENT_SLOT_HELD",
        message: "Replacement slot is temporarily held"
      });
    }

    if (activeAppointment) {
      throw new ConflictException({
        code: "REPLACEMENT_SLOT_BOOKED",
        message: "Replacement slot is already booked"
      });
    }
  }

  private resolveSlotFee(slot: ReplacementSlot) {
    return (
      slot.doctorClinicService.feeMinor ??
      slot.doctorClinic.defaultConsultationFeeMinor ??
      0n
    );
  }

  private resolveSlotServiceName(slot: ReplacementSlot) {
    return (
      slot.doctorClinicService.clinicService.displayName ??
      slot.doctorClinicService.clinicService.service.name
    );
  }

  private requiresOnlineDifferencePayment(appointment: AppointmentForOperation) {
    return (
      appointment.paymentMode !== PaymentMode.PAY_AT_CLINIC &&
      Boolean(this.getLatestSuccessfulPayment(appointment))
    );
  }

  private getLatestSuccessfulPayment(appointment: AppointmentForOperation) {
    return appointment.payments.find((payment) => payment.status === PaymentStatus.SUCCESSFUL) ?? null;
  }

  private async releaseOldAppointmentHolds(
    tx: Prisma.TransactionClient,
    appointment: AppointmentForOperation,
    now: Date
  ) {
    if (!appointment.slotId) {
      return;
    }

    await tx.appointmentSlotHold.updateMany({
      where: {
        appointmentId: appointment.id,
        slotId: appointment.slotId,
        status: { in: [SlotHoldStatus.ACTIVE, SlotHoldStatus.CONVERTED] }
      },
      data: {
        status: SlotHoldStatus.RELEASED,
        resolvedAt: now
      }
    });
  }

  private async getActiveHoldMinutes(tx: PrismaExecutor) {
    const setting = await tx.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.max_active_slot_hold_minutes"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? Number(setting.value.value)
        : NaN;

    return Number.isFinite(value) && value > 0 ? value : 10;
  }

  private async findIdempotentRequest(
    tx: PrismaExecutor,
    appointmentId: string,
    idempotencyKey: string
  ) {
    return tx.appointmentRescheduleRequest.findFirst({
      where: {
        appointmentId,
        rescheduleIdempotencyKey: idempotencyKey
      },
      include: this.rescheduleRequestInclude()
    });
  }

  private async getRescheduleRequestForResponse(tx: PrismaExecutor, requestId: string) {
    return tx.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: this.rescheduleRequestInclude()
    });
  }

  private rescheduleRequestInclude() {
    return {
      holds: {
        orderBy: { createdAt: "desc" }
      },
      payments: {
        orderBy: { createdAt: "desc" }
      }
    } satisfies Prisma.AppointmentRescheduleRequestInclude;
  }

  private assertSameRequestHash(request: RescheduleRequestRecord, requestHash: string) {
    if (request.rescheduleRequestHash !== requestHash) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Idempotency key was already used with a different request"
      });
    }
  }

  private async tryResolveIdempotencyConflict(
    error: unknown,
    appointmentId: string,
    idempotencyKey: string,
    requestHash: string
  ) {
    if (!this.isIdempotencyUniqueConflict(error)) {
      return null;
    }

    const existing = await this.findIdempotentRequest(this.prisma, appointmentId, idempotencyKey);

    if (!existing) {
      return null;
    }

    this.assertSameRequestHash(existing, requestHash);
    return existing;
  }

  private isIdempotencyUniqueConflict(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    return error.code === "P2002" && this.getDatabaseErrorTarget(error).includes("reschedule");
  }

  private throwMappedDatabaseError(error: unknown): never | void {
    const message = error instanceof Error ? error.message : "";

    if (
      message.includes("appointment_slot_holds_one_active_per_slot_uidx") ||
      message.includes("REPLACEMENT_SLOT_HELD")
    ) {
      throw new ConflictException({
        code: "REPLACEMENT_SLOT_HELD",
        message: "Replacement slot is temporarily held"
      });
    }

    if (
      message.includes("appointments_doctor_no_overlap_excl") ||
      message.includes("conflicting key value violates exclusion constraint")
    ) {
      throw new ConflictException({
        code: "DOCTOR_TIME_CONFLICT",
        message: "Doctor already has an appointment at this time"
      });
    }
  }

  private getDatabaseErrorTarget(error: Prisma.PrismaClientKnownRequestError) {
    const rawTarget = error.meta?.target;

    if (Array.isArray(rawTarget)) {
      return rawTarget.join(",");
    }

    return `${String(rawTarget ?? "")} ${String(error.meta?.message ?? "")} ${error.message}`;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    actionCode: string,
    appointment: AppointmentForOperation,
    context: RequestContext,
    metadata: Record<string, unknown>
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode,
        entityType: "appointment",
        entityId: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: this.toJson(metadata) as Prisma.InputJsonValue
      }
    });
  }

  private hashRescheduleRequest(input: RescheduleAppointmentInput) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          replacementSlotId: input.replacementSlotId,
          reason: input.reason ?? null
        })
      )
      .digest("hex");
  }

  private createDerivedIdempotencyKey(prefix: string, patientId: string, idempotencyKey: string) {
    return `${prefix}|${createHash("sha256")
      .update(`${patientId}|${idempotencyKey}`)
      .digest("hex")
      .slice(0, 56)}`;
  }

  private async getDatabaseNow(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now()::timestamptz AS "now"`;

    return rows[0]?.now ?? new Date();
  }

  private serializeRescheduleResponse(request: RescheduleRequestRecord, idempotentReplay: boolean) {
    return {
      appointmentId: request.appointmentId,
      rescheduleRequest: this.serializeRescheduleRequest(request),
      idempotentReplay
    };
  }

  private serializeRescheduleRequest(request: RescheduleRequestRecord) {
    const payment = request.payments[0] ?? null;
    const hold = request.holds[0] ?? null;
    const gateway = payment ? parseGatewayResponse(payment.gatewayResponse) : null;

    return {
      requestId: request.id,
      id: request.id,
      status: this.serializeRescheduleUiStatus(request, payment, hold),
      rawStatus: request.status.toLowerCase(),
      oldSlotId: request.oldSlotId,
      newSlotId: request.newSlotId,
      oldStartsAt: request.oldStartsAt.toISOString(),
      oldEndsAt: request.oldEndsAt.toISOString(),
      newStartsAt: request.newStartsAt.toISOString(),
      newEndsAt: request.newEndsAt.toISOString(),
      originalAppointment: {
        startsAt: request.oldStartsAt.toISOString(),
        endsAt: request.oldEndsAt.toISOString()
      },
      replacementSlot: {
        slotId: request.newSlotId,
        startsAt: request.newStartsAt.toISOString(),
        endsAt: request.newEndsAt.toISOString()
      },
      oldFeeMinor: request.oldFeeMinor.toString(),
      newFeeMinor: request.newFeeMinor.toString(),
      differenceFeeMinor: request.differenceFeeMinor.toString(),
      oldAmountMinor: request.oldFeeMinor.toString(),
      newAmountMinor: request.newFeeMinor.toString(),
      differenceMinor: request.differenceFeeMinor.toString(),
      currency: request.currency,
      reason: request.reason,
      createdAt: request.createdAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      expiresAt: gateway?.expiresAt ?? hold?.expiresAt.toISOString() ?? null,
      hold: hold
        ? {
            id: hold.id,
            status: hold.status.toLowerCase(),
            expiresAt: hold.expiresAt.toISOString(),
            resolvedAt: hold.resolvedAt?.toISOString() ?? null
          }
        : null,
      payment: payment
        ? {
            paymentId: payment.id,
            id: payment.id,
            status: payment.status.toLowerCase(),
            provider: payment.provider,
            providerPaymentId: payment.providerPaymentId,
            amountMinor: payment.amountMinor.toString(),
            currency: payment.currency,
            checkoutUrl: gateway?.checkoutUrl ?? null,
            checkoutFields: gateway?.checkoutFields ?? null,
            expiresAt: gateway?.expiresAt ?? hold?.expiresAt.toISOString() ?? null,
            reconciliationRequired: gateway?.reconciliationRequired ?? false,
            redirectPending: payment.status === PaymentStatus.INITIATED
          }
        : null,
      refund: null
    };
  }

  private serializeRescheduleUiStatus(
    request: RescheduleRequestRecord,
    payment: RescheduleRequestRecord["payments"][number] | null,
    hold: RescheduleRequestRecord["holds"][number] | null
  ) {
    if (request.status === RescheduleRequestStatus.APPLIED) {
      return "completed";
    }

    if (request.status === RescheduleRequestStatus.REJECTED) {
      return "failed";
    }

    if (request.status === RescheduleRequestStatus.CANCELLED) {
      return hold?.status === SlotHoldStatus.EXPIRED ? "expired" : "cancelled";
    }

    if (payment) {
      if (payment.status === PaymentStatus.FAILED) {
        return "failed";
      }

      if (payment.status === PaymentStatus.CANCELLED) {
        return hold?.status === SlotHoldStatus.EXPIRED ? "expired" : "cancelled";
      }

      return "pending_payment";
    }

    return "pending";
  }

  private serializeRefund(refund: RefundRecord) {
    return {
      id: refund.id,
      paymentId: refund.paymentId,
      status: refund.status.toLowerCase(),
      uiStatus: this.serializeRefundUiStatus(refund.status),
      provider: refund.provider,
      providerRefundId: refund.providerRefundId,
      amountMinor: refund.amountMinor.toString(),
      currency: refund.currency,
      reason: refund.reason,
      requestedAt: refund.requestedAt.toISOString(),
      processedAt: refund.processedAt?.toISOString() ?? null
    };
  }

  private serializeRefundUiStatus(status: RefundStatus) {
    if (status === RefundStatus.PROCESSED) {
      return "completed";
    }

    if (status === RefundStatus.PROCESSING || status === RefundStatus.APPROVED) {
      return "processing";
    }

    if (status === RefundStatus.FAILED || status === RefundStatus.REJECTED) {
      return "failed";
    }

    return "requested";
  }

  private buildRescheduleVariables(request: RescheduleRequestRecord) {
    return {
      id: request.id,
      status: request.status.toLowerCase(),
      oldStartsAt: request.oldStartsAt.toISOString(),
      newStartsAt: request.newStartsAt.toISOString(),
      oldAmountMinor: request.oldFeeMinor.toString(),
      newAmountMinor: request.newFeeMinor.toString(),
      differenceMinor: request.differenceFeeMinor.toString(),
      currency: request.currency
    };
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      this.logger.error("notification.enqueue_failed", {}, error);
    }
  }

  private toJson<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      )
    ) as T;
  }
}

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type AppointmentForOperation = Prisma.AppointmentGetPayload<{
  include: {
    doctorClinicService: true;
    payments: {
      orderBy: {
        createdAt: "desc";
      };
    };
    refunds: true;
  };
}>;

type AppointmentForPolicy = {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  doctorClinicService: {
    rescheduleWindowMinutes: number | null;
    maxReschedules: number | null;
  };
};

type ReplacementSlot = Prisma.AppointmentSlotGetPayload<{
  include: {
    doctorClinic: {
      include: {
        clinic: true;
        clinicLocation: true;
        doctor: true;
      };
    };
    doctorClinicService: {
      include: {
        clinicService: {
          include: {
            service: true;
          };
        };
      };
    };
  };
}>;

type RescheduleRequestRecord = Prisma.AppointmentRescheduleRequestGetPayload<{
  include: {
    holds: {
      orderBy: {
        createdAt: "desc";
      };
    };
    payments: {
      orderBy: {
        createdAt: "desc";
      };
    };
  };
}>;

type RefundRecord = Prisma.RefundGetPayload<Record<string, never>>;
