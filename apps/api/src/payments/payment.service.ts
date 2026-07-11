import { createHash } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import {
  AppointmentStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RescheduleRequestStatus,
  SlotHoldStatus
} from "@doctobook/database";
import {
  PaymentProviderError,
  VerifiedWebhookEvent,
  createPaymentProviderFromEnv,
  parseGatewayResponse
} from "@doctobook/payments";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  async getPatientAppointmentPayment(actor: AuthenticatedUser, appointmentId: string) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      include: {
        holds: {
          where: { status: SlotHoldStatus.ACTIVE },
          orderBy: { expiresAt: "desc" },
          take: 1
        },
        rescheduleRequests: {
          include: {
            holds: {
              where: { status: SlotHoldStatus.ACTIVE },
              orderBy: { expiresAt: "desc" },
              take: 1
            }
          },
          orderBy: { createdAt: "desc" },
          take: 5
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    const payment = appointment.payments[0] ?? null;
    const rescheduleHold =
      payment?.rescheduleRequestId
        ? appointment.rescheduleRequests.find((request) => request.id === payment.rescheduleRequestId)
            ?.holds[0] ?? null
        : null;

    return {
      appointmentId: appointment.id,
      appointmentStatus: appointment.status.toLowerCase(),
      payment: payment
        ? this.serializePaymentStatus(
            payment,
            rescheduleHold?.expiresAt ?? appointment.holds[0]?.expiresAt ?? null
          )
        : null
    };
  }

  async processWebhook(
    providerName: string,
    payload: unknown,
    headers: Record<string, string | string[] | undefined>
  ) {
    const provider = createPaymentProviderFromEnv({
      ...process.env,
      PAYMENT_PROVIDER: providerName
    });

    let verified: VerifiedWebhookEvent;

    try {
      verified = await provider.verifyWebhook({ payload, headers });
    } catch (error) {
      await this.persistInvalidWebhook(provider.name, payload, error);
      this.throwWebhookVerificationError(error);
      throw error;
    }

    const webhookEvent = await this.getOrCreateWebhookEvent(verified);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWebhookEvent(tx, webhookEvent.id);
      const lockedEvent = await tx.paymentWebhookEvent.findUniqueOrThrow({
        where: { id: webhookEvent.id }
      });

      if (lockedEvent.processedAt) {
        return {
          received: true,
          processed: false,
          duplicate: true
        };
      }

      if (!uuidPattern.test(verified.internalPaymentId)) {
        await this.rejectWebhookEvent(tx, lockedEvent.id, "Unknown internal payment reference", verified);

        return {
          received: true,
          processed: false,
          rejected: true,
          code: "PAYMENT_REFERENCE_UNKNOWN"
        };
      }

      await this.lockPayment(tx, verified.internalPaymentId);
      const payment = await tx.payment.findUnique({
        where: { id: verified.internalPaymentId },
        include: {
          appointment: true,
          rescheduleRequest: {
            include: {
              newDoctorService: {
                include: {
                  clinicService: {
                    include: {
                      service: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!payment) {
        await this.rejectWebhookEvent(tx, lockedEvent.id, "Payment reference not found", verified);

        return {
          received: true,
          processed: false,
          rejected: true,
          code: "PAYMENT_REFERENCE_UNKNOWN"
        };
      }

      await this.lockAppointment(tx, payment.appointmentId);
      if (payment.rescheduleRequestId) {
        await this.lockRescheduleRequest(tx, payment.rescheduleRequestId);
      }

      const hold =
        payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE &&
        payment.rescheduleRequestId
          ? await tx.appointmentSlotHold.findFirst({
              where: {
                rescheduleRequestId: payment.rescheduleRequestId,
                status: { in: [SlotHoldStatus.ACTIVE, SlotHoldStatus.CONVERTED] }
              },
              orderBy: { createdAt: "desc" }
            })
          : await tx.appointmentSlotHold.findFirst({
              where: {
                appointmentId: payment.appointmentId,
                status: { in: [SlotHoldStatus.ACTIVE, SlotHoldStatus.CONVERTED] }
              },
              orderBy: { createdAt: "desc" }
            });

      if (hold) {
        await this.lockSlotHold(tx, hold.id);
      }

      if (payment.amountMinor !== verified.amountMinor) {
        await this.rejectWebhookEvent(tx, lockedEvent.id, "Payment amount mismatch", verified, payment.id);
        await this.writeAudit(tx, "payment.webhook.rejected", payment, {
          reason: "amount_mismatch",
          expectedAmountMinor: payment.amountMinor.toString(),
          receivedAmountMinor: verified.amountMinor.toString()
        });

        return {
          received: true,
          processed: false,
          rejected: true,
          code: "PAYMENT_AMOUNT_MISMATCH"
        };
      }

      if (payment.currency !== verified.currency) {
        await this.rejectWebhookEvent(tx, lockedEvent.id, "Payment currency mismatch", verified, payment.id);
        await this.writeAudit(tx, "payment.webhook.rejected", payment, {
          reason: "currency_mismatch",
          expectedCurrency: payment.currency,
          receivedCurrency: verified.currency
        });

        return {
          received: true,
          processed: false,
          rejected: true,
          code: "PAYMENT_CURRENCY_MISMATCH"
        };
      }

      return this.applyVerifiedWebhook(tx, {
        eventId: lockedEvent.id,
        payment,
        hold,
        verified
      });
    });
    await this.enqueueWebhookNotification(verified.internalPaymentId, result);

    return result;
  }

  private async applyVerifiedWebhook(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      payment: PaymentWithAppointment;
      hold: SlotHoldRecord | null;
      verified: VerifiedWebhookEvent;
    }
  ) {
    const now = new Date();
    const { eventId, payment, hold, verified } = input;

    if (verified.status === PaymentStatus.SUCCESSFUL) {
      return this.applySuccessfulPayment(tx, payment, hold, verified, eventId, now);
    }

    if (verified.status === PaymentStatus.CANCELLED) {
      return this.applyCancelledPayment(tx, payment, hold, verified, eventId, now);
    }

    if (verified.status === PaymentStatus.FAILED) {
      return this.applyFailedPayment(tx, payment, verified, eventId);
    }

    return this.applyPendingPayment(tx, payment, verified, eventId);
  }

  private async applySuccessfulPayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    hold: SlotHoldRecord | null,
    verified: VerifiedWebhookEvent,
    eventId: string,
    now: Date
  ) {
    const alreadySuccessful = payment.status === PaymentStatus.SUCCESSFUL;

    if (payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE) {
      return this.applySuccessfulReschedulePayment(tx, payment, hold, verified, eventId, now);
    }

    if (!alreadySuccessful) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.SUCCESSFUL, {
        paidAt: verified.paidAt ?? now
      });
    }

    if (
      payment.appointment.status === AppointmentStatus.PENDING_PAYMENT &&
      hold?.status === SlotHoldStatus.ACTIVE
    ) {
      await tx.appointment.update({
        where: { id: payment.appointmentId },
        data: { status: AppointmentStatus.CONFIRMED }
      });
      await tx.appointmentSlotHold.update({
        where: { id: hold.id },
        data: {
          status: SlotHoldStatus.CONVERTED,
          resolvedAt: now
        }
      });
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: payment.appointmentId,
          fromStatus: AppointmentStatus.PENDING_PAYMENT,
          toStatus: AppointmentStatus.CONFIRMED,
          reason: "Payment succeeded",
          metadata: this.toJson({
            source: "payment_webhook",
            webhookEventId: eventId
          }) as Prisma.InputJsonValue
        }
      });
      await this.writeAudit(tx, "payment.succeeded", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId
      });
    } else if (!alreadySuccessful) {
      await this.markReconciliationRequired(tx, payment, verified, eventId);
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: !alreadySuccessful,
      duplicate: alreadySuccessful,
      status: "successful"
    };
  }

  private async applySuccessfulReschedulePayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    hold: SlotHoldRecord | null,
    verified: VerifiedWebhookEvent,
    eventId: string,
    now: Date
  ) {
    const alreadySuccessful = payment.status === PaymentStatus.SUCCESSFUL;

    if (!alreadySuccessful) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.SUCCESSFUL, {
        paidAt: verified.paidAt ?? now
      });
    }

    if (
      payment.rescheduleRequest &&
      payment.rescheduleRequest.status === RescheduleRequestStatus.REQUESTED &&
      hold?.status === SlotHoldStatus.ACTIVE
    ) {
      await tx.appointmentSlotHold.updateMany({
        where: {
          appointmentId: payment.appointmentId,
          slotId: payment.appointment.slotId ?? undefined,
          status: { in: [SlotHoldStatus.ACTIVE, SlotHoldStatus.CONVERTED] }
        },
        data: {
          status: SlotHoldStatus.RELEASED,
          resolvedAt: now
        }
      });
      await tx.appointment.update({
        where: { id: payment.appointmentId },
        data: {
          slotId: payment.rescheduleRequest.newSlotId,
          startsAt: payment.rescheduleRequest.newStartsAt,
          endsAt: payment.rescheduleRequest.newEndsAt,
          doctorClinicServiceId: payment.rescheduleRequest.newDoctorClinicServiceId,
          serviceNameSnapshot:
            payment.rescheduleRequest.newDoctorService.clinicService.displayName ??
            payment.rescheduleRequest.newDoctorService.clinicService.service.name,
          serviceDurationMinutes: payment.rescheduleRequest.newDoctorService.durationMinutes,
          feeMinor: payment.rescheduleRequest.newFeeMinor,
          currency: payment.rescheduleRequest.currency
        }
      });
      await tx.appointmentRescheduleRequest.update({
        where: { id: payment.rescheduleRequest.id },
        data: {
          status: RescheduleRequestStatus.APPLIED,
          resolvedAt: now
        }
      });
      await tx.appointmentSlotHold.update({
        where: { id: hold.id },
        data: {
          status: SlotHoldStatus.CONVERTED,
          resolvedAt: now
        }
      });
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: payment.appointmentId,
          fromStatus: payment.appointment.status,
          toStatus: payment.appointment.status,
          reason: "Reschedule difference payment succeeded",
          metadata: this.toJson({
            source: "payment_webhook",
            webhookEventId: eventId,
            rescheduleRequestId: payment.rescheduleRequest.id,
            paymentId: payment.id,
            oldSlotId: payment.rescheduleRequest.oldSlotId,
            newSlotId: payment.rescheduleRequest.newSlotId
          }) as Prisma.InputJsonValue
        }
      });
      await this.writeAudit(tx, "appointment.reschedule.applied", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId,
        rescheduleRequestId: payment.rescheduleRequest.id
      });
    } else if (!alreadySuccessful) {
      await this.markReconciliationRequired(tx, payment, verified, eventId);
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: !alreadySuccessful,
      duplicate: alreadySuccessful,
      status: "successful"
    };
  }

  private async applyCancelledPayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    hold: SlotHoldRecord | null,
    verified: VerifiedWebhookEvent,
    eventId: string,
    now: Date
  ) {
    if (payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE) {
      return this.applyCancelledReschedulePayment(tx, payment, hold, verified, eventId, now);
    }

    if (payment.status !== PaymentStatus.SUCCESSFUL && payment.status !== PaymentStatus.CANCELLED) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.CANCELLED);

      if (
        payment.appointment.status === AppointmentStatus.PENDING_PAYMENT &&
        hold?.status === SlotHoldStatus.ACTIVE
      ) {
        await tx.appointmentSlotHold.update({
          where: { id: hold.id },
          data: {
            status: SlotHoldStatus.RELEASED,
            resolvedAt: now
          }
        });
        await tx.appointment.update({
          where: { id: payment.appointmentId },
          data: { status: AppointmentStatus.EXPIRED }
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: payment.appointmentId,
            fromStatus: AppointmentStatus.PENDING_PAYMENT,
            toStatus: AppointmentStatus.EXPIRED,
            reason: "Payment was cancelled",
            metadata: this.toJson({
              source: "payment_webhook",
              webhookEventId: eventId
            }) as Prisma.InputJsonValue
          }
        });
      }

      await this.writeAudit(tx, "payment.cancelled", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId
      });
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: payment.status !== PaymentStatus.CANCELLED,
      status: "cancelled"
    };
  }

  private async applyCancelledReschedulePayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    hold: SlotHoldRecord | null,
    verified: VerifiedWebhookEvent,
    eventId: string,
    now: Date
  ) {
    if (payment.status !== PaymentStatus.SUCCESSFUL && payment.status !== PaymentStatus.CANCELLED) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.CANCELLED);
      await this.cancelRescheduleRequestForPayment(tx, payment, hold, now, "Payment was cancelled");
      await this.writeAudit(tx, "payment.cancelled", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId,
        rescheduleRequestId: payment.rescheduleRequestId
      });
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: payment.status !== PaymentStatus.CANCELLED,
      status: "cancelled"
    };
  }

  private async applyFailedPayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    verified: VerifiedWebhookEvent,
    eventId: string
  ) {
    if (payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE) {
      return this.applyFailedReschedulePayment(tx, payment, verified, eventId);
    }

    if (payment.status !== PaymentStatus.SUCCESSFUL && payment.status !== PaymentStatus.FAILED) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.FAILED);
      await this.writeAudit(tx, "payment.failed", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId
      });
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: payment.status !== PaymentStatus.FAILED,
      status: "failed"
    };
  }

  private async applyFailedReschedulePayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    verified: VerifiedWebhookEvent,
    eventId: string
  ) {
    if (payment.status !== PaymentStatus.SUCCESSFUL && payment.status !== PaymentStatus.FAILED) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.FAILED);
      const hold = payment.rescheduleRequestId
        ? await tx.appointmentSlotHold.findFirst({
            where: {
              rescheduleRequestId: payment.rescheduleRequestId,
              status: SlotHoldStatus.ACTIVE
            },
            orderBy: { createdAt: "desc" }
          })
        : null;
      await this.cancelRescheduleRequestForPayment(
        tx,
        payment,
        hold,
        new Date(),
        "Payment failed"
      );
      await this.writeAudit(tx, "payment.failed", payment, {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId,
        webhookEventId: eventId,
        rescheduleRequestId: payment.rescheduleRequestId
      });
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: payment.status !== PaymentStatus.FAILED,
      status: "failed"
    };
  }

  private async cancelRescheduleRequestForPayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    hold: SlotHoldRecord | null,
    now: Date,
    reason: string
  ) {
    if (!payment.rescheduleRequestId) {
      return;
    }

    if (hold?.status === SlotHoldStatus.ACTIVE) {
      await tx.appointmentSlotHold.update({
        where: { id: hold.id },
        data: {
          status: SlotHoldStatus.RELEASED,
          resolvedAt: now
        }
      });
    }

    await tx.appointmentRescheduleRequest.updateMany({
      where: {
        id: payment.rescheduleRequestId,
        status: RescheduleRequestStatus.REQUESTED
      },
      data: {
        status: RescheduleRequestStatus.CANCELLED,
        resolvedAt: now,
        reason
      }
    });
  }

  private async applyPendingPayment(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    verified: VerifiedWebhookEvent,
    eventId: string
  ) {
    if (payment.status === PaymentStatus.INITIATED) {
      await this.updatePaymentStatus(tx, payment, verified, eventId, PaymentStatus.PENDING);
    }

    await this.markWebhookProcessed(tx, eventId);

    return {
      received: true,
      processed: payment.status === PaymentStatus.INITIATED,
      status: "pending"
    };
  }

  private async updatePaymentStatus(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    verified: VerifiedWebhookEvent,
    eventId: string,
    nextStatus: PaymentStatus,
    options: { paidAt?: Date } = {}
  ) {
    const gatewayResponse = this.mergeGatewayResponse(payment.gatewayResponse, {
      provider: verified.provider,
      providerPaymentId: verified.providerPaymentId ?? null,
      providerStatus: verified.rawStatus,
      paymentMethod: verified.paymentMethod ?? null,
      webhookEventId: eventId,
      webhookPayload: this.redactWebhookPayload(verified.payload)
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        provider: verified.provider,
        providerPaymentId: verified.providerPaymentId ?? payment.providerPaymentId,
        paymentMethod: verified.paymentMethod ?? payment.paymentMethod,
        status: nextStatus,
        paidAt: nextStatus === PaymentStatus.SUCCESSFUL ? options.paidAt ?? new Date() : payment.paidAt,
        gatewayResponse: gatewayResponse as Prisma.InputJsonValue
      }
    });

    if (payment.status !== nextStatus) {
      await tx.paymentStatusHistory.create({
        data: {
          paymentId: payment.id,
          fromStatus: payment.status,
          toStatus: nextStatus,
          webhookEventId: eventId,
          reason: `Provider webhook status ${verified.rawStatus}`,
          metadata: gatewayResponse as Prisma.InputJsonValue
        }
      });
    }
  }

  private async markReconciliationRequired(
    tx: Prisma.TransactionClient,
    payment: PaymentWithAppointment,
    verified: VerifiedWebhookEvent,
    eventId: string
  ) {
    const gatewayResponse = this.mergeGatewayResponse(payment.gatewayResponse, {
      provider: verified.provider,
      providerPaymentId: verified.providerPaymentId ?? null,
      providerStatus: verified.rawStatus,
      webhookEventId: eventId,
      reconciliationRequired: true,
      reconciliationReason: "payment_success_after_hold_or_appointment_expiration"
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        gatewayResponse: gatewayResponse as Prisma.InputJsonValue
      }
    });
    await this.writeAudit(tx, "payment.reconciliation_required", payment, {
      provider: verified.provider,
      providerPaymentId: verified.providerPaymentId,
      webhookEventId: eventId,
      appointmentStatus: payment.appointment.status
    });
  }

  private async getOrCreateWebhookEvent(verified: VerifiedWebhookEvent) {
    return this.prisma.paymentWebhookEvent.upsert({
      where: {
        provider_providerEventId: {
          provider: verified.provider,
          providerEventId: verified.providerEventId
        }
      },
      update: {},
      create: {
        provider: verified.provider,
        providerEventId: verified.providerEventId,
        eventType: verified.rawStatus,
        payload: this.toJson(verified.payload) as Prisma.InputJsonValue,
        signatureValid: true
      }
    });
  }

  private async persistInvalidWebhook(provider: string, payload: unknown, error: unknown) {
    await this.prisma.paymentWebhookEvent.create({
      data: {
        provider,
        providerEventId: `invalid|${this.hashPayload(payload)}`,
        eventType: "invalid_signature",
        payload: this.toJson({
          payload,
          error: this.safeErrorCode(error)
        }) as Prisma.InputJsonValue,
        signatureValid: false,
        processedAt: new Date(),
        error: this.safeErrorCode(error)
      }
    }).catch(() => null);
  }

  private async rejectWebhookEvent(
    tx: Prisma.TransactionClient,
    eventId: string,
    error: string,
    verified: VerifiedWebhookEvent,
    paymentId?: string
  ) {
    await tx.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        processedAt: new Date(),
        error
      }
    });

    await tx.auditLog.create({
      data: {
        actionCode: "payment.webhook.rejected",
        entityType: "payment_webhook_event",
        entityId: eventId,
        patientId: null,
        metadata: this.toJson({
          paymentId,
          provider: verified.provider,
          providerEventId: verified.providerEventId,
          error
        }) as Prisma.InputJsonValue
      }
    });
  }

  private async markWebhookProcessed(tx: Prisma.TransactionClient, eventId: string) {
    await tx.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        processedAt: new Date(),
        error: null
      }
    });
  }

  private async lockWebhookEvent(tx: Prisma.TransactionClient, eventId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "payment_webhook_events"
      WHERE "id" = CAST(${eventId} AS uuid)
      FOR UPDATE
    `;
  }

  private async lockPayment(tx: Prisma.TransactionClient, paymentId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "payments"
      WHERE "id" = CAST(${paymentId} AS uuid)
      FOR UPDATE
    `;
  }

  private async lockAppointment(tx: Prisma.TransactionClient, appointmentId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "appointments"
      WHERE "id" = CAST(${appointmentId} AS uuid)
      FOR UPDATE
    `;
  }

  private async lockSlotHold(tx: Prisma.TransactionClient, holdId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "appointment_slot_holds"
      WHERE "id" = CAST(${holdId} AS uuid)
      FOR UPDATE
    `;
  }

  private async lockRescheduleRequest(tx: Prisma.TransactionClient, requestId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "appointment_reschedule_requests"
      WHERE "id" = CAST(${requestId} AS uuid)
      FOR UPDATE
    `;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    actionCode: string,
    payment: PaymentWithAppointment,
    metadata: Record<string, unknown>
  ) {
    await tx.auditLog.create({
      data: {
        actionCode,
        entityType: "payment",
        entityId: payment.id,
        clinicId: payment.appointment.clinicId,
        patientId: payment.patientId,
        metadata: this.toJson({
          appointmentId: payment.appointmentId,
          ...metadata
        }) as Prisma.InputJsonValue
      }
    });
  }

  private serializePaymentStatus(payment: PatientPaymentRecord, holdExpiresAt: Date | null) {
    const gateway = parseGatewayResponse(payment.gatewayResponse);

    return {
      paymentId: payment.id,
      status: payment.status.toLowerCase(),
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      checkoutUrl: gateway?.checkoutUrl ?? null,
      checkoutFields: gateway?.checkoutFields ?? null,
      expiresAt: gateway?.expiresAt ?? holdExpiresAt?.toISOString() ?? null,
      reconciliationRequired: gateway?.reconciliationRequired ?? false
    };
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

  private throwWebhookVerificationError(error: unknown): never | void {
    if (error instanceof PaymentProviderError) {
      const response = {
        code: error.code,
        message: "Payment webhook verification failed"
      };

      if (error.statusCode === 401) {
        throw new UnauthorizedException(response);
      }

      throw new BadRequestException(response);
    }
  }

  private safeErrorCode(error: unknown) {
    return error instanceof PaymentProviderError ? error.code : "PAYMENT_WEBHOOK_INVALID";
  }

  private hashPayload(payload: unknown) {
    return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 48);
  }

  private mergeGatewayResponse(
    current: Prisma.JsonValue | null,
    updates: Record<string, unknown>
  ) {
    const existing =
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return this.toJson({
      ...existing,
      ...updates
    });
  }

  private redactWebhookPayload(payload: Record<string, unknown>) {
    const redacted = { ...payload };

    for (const key of Object.keys(redacted)) {
      if (key.toLowerCase().includes("sig") || key.toLowerCase().includes("secret")) {
        redacted[key] = "[redacted]";
      }
    }

    return redacted;
  }

  private toJson<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      )
    ) as T;
  }

  private async enqueueWebhookNotification(
    paymentId: string,
    result: { processed?: boolean; duplicate?: boolean; rejected?: boolean; status?: string }
  ) {
    if (!result.processed || result.duplicate || result.rejected || !result.status) {
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        appointmentId: true,
        paymentPurpose: true
      }
    });

    if (!payment) {
      return;
    }

    const eventCode =
      payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE &&
      result.status === "successful"
        ? "reschedule.completed"
        : result.status === "successful"
          ? "payment.succeeded"
          : result.status === "cancelled"
            ? "payment.cancelled"
            : result.status === "failed"
              ? "payment.failed"
              : null;

    if (!eventCode) {
      return;
    }

    await this.safeNotify(() =>
      payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE &&
      result.status === "successful"
        ? this.notificationService.enqueueAppointmentEvent(payment.appointmentId, eventCode, {
            audiences: ["patient", "doctor"],
            idempotencyKeySuffix: payment.id
          })
        : this.notificationService.enqueuePaymentEvent(payment.id, eventCode)
    );
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.warn("Notification enqueue failed", error);
    }
  }
}

type PaymentWithAppointment = Prisma.PaymentGetPayload<{
  include: {
    appointment: true;
    rescheduleRequest: {
      include: {
        newDoctorService: {
          include: {
            clinicService: {
              include: {
                service: true;
              };
            };
          };
        };
      };
    };
  };
}>;

type SlotHoldRecord = Prisma.AppointmentSlotHoldGetPayload<Record<string, never>>;

type PatientPaymentRecord = Prisma.PaymentGetPayload<Record<string, never>>;
