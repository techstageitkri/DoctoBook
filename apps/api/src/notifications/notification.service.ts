import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationChannel, NotificationStatus, Prisma, ScopeType } from "@doctobook/database";
import {
  createNotificationLogs,
  createRecipientEmailNotificationLogs,
  getNotificationProviderHealth
} from "@doctobook/notifications";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationQueueService } from "./notification-queue.service.js";
import {
  ListNotificationLogsQuery,
  ListNotificationTemplatesQuery,
  UpsertNotificationTemplateInput
} from "./notification.schemas.js";

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueueService
  ) {}

  async listTemplates(query: ListNotificationTemplatesQuery) {
    const templates = await this.prisma.notificationTemplate.findMany({
      where: {
        ...(query.eventCode ? { eventCode: query.eventCode } : {}),
        ...(query.channel ? { channel: this.toNotificationChannel(query.channel) } : {}),
        ...(query.scopeType ? { scopeType: this.toScopeType(query.scopeType) } : {}),
        ...(query.scopeId ? { scopeId: query.scopeId } : {})
      },
      orderBy: [{ eventCode: "asc" }, { channel: "asc" }, { locale: "asc" }],
      take: query.limit
    });

    return {
      templates: templates.map((template) => this.serializeTemplate(template))
    };
  }

  async upsertTemplate(
    actor: AuthenticatedUser,
    input: UpsertNotificationTemplateInput,
    context: RequestContext
  ) {
    const scopeType = this.toScopeType(input.scopeType);
    const channel = this.toNotificationChannel(input.channel);
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: {
        scopeType,
        scopeId: input.scopeId ?? null,
        eventCode: input.eventCode,
        channel,
        locale: input.locale
      },
      select: { id: true }
    });

    const template = existing
      ? await this.prisma.notificationTemplate.update({
          where: { id: existing.id },
          data: {
            subject: input.subject ?? null,
            body: input.body,
            isActive: input.isActive
          }
        })
      : await this.prisma.notificationTemplate.create({
          data: {
            scopeType,
            scopeId: input.scopeId ?? null,
            eventCode: input.eventCode,
            channel,
            locale: input.locale,
            subject: input.subject ?? null,
            body: input.body,
            isActive: input.isActive
          }
        });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "notification.template.upsert",
        entityType: "notification_template",
        entityId: template.id,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: {
          eventCode: template.eventCode,
          channel: template.channel,
          scopeType: template.scopeType,
          scopeId: template.scopeId
        }
      }
    });

    return {
      template: this.serializeTemplate(template)
    };
  }

  async listLogs(query: ListNotificationLogsQuery) {
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        ...(query.eventCode ? { eventCode: query.eventCode } : {}),
        ...(query.channel ? { channel: this.toNotificationChannel(query.channel) } : {}),
        ...(query.status ? { status: this.toNotificationStatus(query.status) } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.appointmentId ? { appointmentId: query.appointmentId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return {
      logs: logs.map((log) => this.serializeLog(log))
    };
  }

  getProviderHealth() {
    return {
      providers: getNotificationProviderHealth(process.env)
    };
  }

  async enqueueUserEvent(input: {
    eventCode: string;
    userId: string;
    appointmentId?: string | null;
    clinicId?: string | null;
    variables?: Record<string, unknown>;
    sensitiveVariables?: Record<string, unknown>;
    channels?: NotificationChannel[];
    idempotencyKeySuffix?: string | null;
    scheduledAt?: Date | null;
  }) {
    const result = await createNotificationLogs(this.prisma, input);

    for (const dispatch of result.dispatches) {
      await this.notificationQueue.enqueueDispatch(dispatch.notificationLogId, dispatch.delivery);
    }

    return result;
  }

  async enqueueRecipientEmail(input: {
    eventCode: string;
    recipientEmail: string;
    clinicId?: string | null;
    variables?: Record<string, unknown>;
    sensitiveVariables?: Record<string, unknown>;
    idempotencyKeySuffix?: string | null;
    scheduledAt?: Date | null;
  }) {
    const result = await createRecipientEmailNotificationLogs(this.prisma, input);

    for (const dispatch of result.dispatches) {
      await this.notificationQueue.enqueueDispatch(dispatch.notificationLogId, dispatch.delivery);
    }

    return result;
  }

  async enqueueAppointmentEvent(
    appointmentId: string,
    eventCode: string,
    options: {
      audiences?: Array<"patient" | "doctor">;
      variables?: Record<string, unknown>;
      idempotencyKeySuffix?: string | null;
      scheduledAt?: Date | null;
    } = {}
  ) {
    const appointment = await this.getAppointmentForNotification(appointmentId);
    const audiences = options.audiences ?? ["patient"];
    const variables = this.buildAppointmentVariables(appointment, options.variables);
    const results = [];

    if (audiences.includes("patient")) {
      results.push(
        await this.enqueueUserEvent({
          eventCode,
          userId: appointment.patient.userId,
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          variables,
          idempotencyKeySuffix: options.idempotencyKeySuffix,
          scheduledAt: options.scheduledAt ?? null
        })
      );
    }

    if (audiences.includes("doctor")) {
      results.push(
        await this.enqueueUserEvent({
          eventCode,
          userId: appointment.doctor.userId,
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          variables,
          idempotencyKeySuffix: options.idempotencyKeySuffix,
          scheduledAt: options.scheduledAt ?? null
        })
      );
    }

    return {
      results
    };
  }

  async enqueuePaymentEvent(paymentId: string, eventCode: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        appointmentId: true
      }
    });

    if (!payment) {
      throw new NotFoundException("Payment not found");
    }

    return this.enqueueAppointmentEvent(payment.appointmentId, eventCode, {
      audiences: ["patient"],
      variables: {
        payment: {
          id: payment.id,
          amount: this.formatMinor(payment.amountMinor, payment.currency),
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency
        }
      },
      idempotencyKeySuffix: payment.id
    });
  }

  async enqueueRefundEvent(refundId: string, eventCode: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        appointmentId: true,
        amountMinor: true,
        currency: true,
        status: true
      }
    });

    if (!refund) {
      throw new NotFoundException("Refund not found");
    }

    return this.enqueueAppointmentEvent(refund.appointmentId, eventCode, {
      audiences: ["patient"],
      variables: {
        refund: {
          id: refund.id,
          amount: this.formatMinor(refund.amountMinor, refund.currency),
          amountMinor: refund.amountMinor.toString(),
          currency: refund.currency,
          status: refund.status.toLowerCase()
        }
      },
      idempotencyKeySuffix: refund.id
    });
  }

  private async getAppointmentForNotification(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: {
          include: {
            user: true
          }
        },
        doctor: {
          include: {
            user: true
          }
        },
        clinic: true,
        clinicLocation: true
      }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return appointment;
  }

  private buildAppointmentVariables(
    appointment: NotificationAppointment,
    extraVariables: Record<string, unknown> = {}
  ) {
    return {
      appointment: {
        id: appointment.id,
        number: appointment.appointmentNumber,
        status: appointment.status.toLowerCase(),
        serviceName: appointment.serviceNameSnapshot,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        amount: this.formatMinor(appointment.feeMinor, appointment.currency),
        amountMinor: appointment.feeMinor.toString(),
        currency: appointment.currency
      },
      patient: {
        id: appointment.patientId,
        name: appointment.patient.user.fullName,
        email: appointment.patient.user.email,
        phone: appointment.patient.user.phone
      },
      doctor: {
        id: appointment.doctorId,
        name: appointment.doctor.user.fullName
      },
      clinic: {
        id: appointment.clinicId,
        name: appointment.clinic.name,
        locationName: appointment.clinicLocation.name,
        city: appointment.clinicLocation.city,
        timezone: appointment.clinicLocation.timezone
      },
      ...extraVariables
    };
  }

  private serializeTemplate(template: Prisma.NotificationTemplateGetPayload<Record<string, never>>) {
    return {
      id: template.id,
      scopeType: template.scopeType.toLowerCase(),
      scopeId: template.scopeId,
      eventCode: template.eventCode,
      channel: template.channel.toLowerCase(),
      locale: template.locale,
      subject: template.subject,
      body: template.body,
      isActive: template.isActive,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString()
    };
  }

  private serializeLog(log: Prisma.NotificationLogGetPayload<Record<string, never>>) {
    return {
      id: log.id,
      userId: log.userId,
      appointmentId: log.appointmentId,
      channel: log.channel.toLowerCase(),
      eventCode: log.eventCode,
      recipient: log.recipient,
      subject: log.subject,
      status: log.status.toLowerCase(),
      provider: log.provider,
      providerMessageId: log.providerMessageId,
      providerStatus: log.providerStatus,
      providerResponse: log.providerResponse,
      failureClassification: log.failureClassification,
      error: log.error,
      attempts: log.attempts,
      scheduledAt: log.scheduledAt?.toISOString() ?? null,
      sentAt: log.sentAt?.toISOString() ?? null,
      createdAt: log.createdAt.toISOString()
    };
  }

  private toNotificationChannel(channel: string) {
    const normalized = channel.toUpperCase() as keyof typeof NotificationChannel;
    const value = NotificationChannel[normalized];

    if (!value) {
      throw new BadRequestException("Invalid notification channel");
    }

    return value;
  }

  private toNotificationStatus(status: string) {
    const normalized = status.toUpperCase() as keyof typeof NotificationStatus;
    const value = NotificationStatus[normalized];

    if (!value) {
      throw new BadRequestException("Invalid notification status");
    }

    return value;
  }

  private toScopeType(scopeType: string) {
    const normalized = scopeType.toUpperCase() as keyof typeof ScopeType;
    const value = ScopeType[normalized];

    if (!value || (value !== ScopeType.PLATFORM && value !== ScopeType.CLINIC)) {
      throw new BadRequestException("Invalid notification template scope");
    }

    return value;
  }

  private formatMinor(amountMinor: bigint, currency: string) {
    return new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency,
      maximumFractionDigits: Number(amountMinor % 100n) === 0 ? 0 : 2
    }).format(Number(amountMinor) / 100);
  }
}

type NotificationAppointment = Prisma.AppointmentGetPayload<{
  include: {
    patient: {
      include: {
        user: true;
      };
    };
    doctor: {
      include: {
        user: true;
      };
    };
    clinic: true;
    clinicLocation: true;
  };
}>;
