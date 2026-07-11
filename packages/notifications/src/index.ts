import { createHash } from "node:crypto";
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
  PrismaClient,
  ScopeType
} from "@doctobook/database";
import {
  createNotificationProvider,
  getNotificationProviderHealth,
  toNotificationDeliveryError
} from "./providers.js";

export { getNotificationProviderHealth };
export type {
  NotificationDeliveryError,
  NotificationFailureClassification,
  NotificationProviderHealth,
  NotificationProviderInput,
  NotificationProviderResult
} from "./providers.js";

export const NOTIFICATION_DISPATCH_QUEUE_NAME = "notification-dispatch";
export const NOTIFICATION_DISPATCH_JOB = "notification.dispatch";
export const NOTIFICATION_SCHEDULE_REMINDERS_JOB = "notification.reminders.schedule";

export type DispatchNotificationJob = {
  notificationLogId: string;
};

export type CreateNotificationEventInput = {
  eventCode: string;
  userId: string;
  appointmentId?: string | null;
  clinicId?: string | null;
  channels?: NotificationChannel[];
  variables?: Record<string, unknown>;
  idempotencyKeySuffix?: string | null;
  scheduledAt?: Date | null;
};

export type NotificationLogSummary = {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  eventCode: string;
  idempotencyKey: string | null;
};

export type CreateNotificationLogsResult = {
  logs: NotificationLogSummary[];
  skipped: Array<{
    channel: NotificationChannel;
    reason: string;
  }>;
};

type NotificationPrisma = PrismaClient | Prisma.TransactionClient;

const defaultChannels = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH
];

export function getNotificationDispatchJobId(notificationLogId: string) {
  return `notification-dispatch|${notificationLogId}`;
}

export async function createNotificationLogs(
  prisma: NotificationPrisma,
  input: CreateNotificationEventInput
): Promise<CreateNotificationLogsResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      phone: true,
      fullName: true,
      pushTokens: {
        where: { isActive: true },
        orderBy: { lastSeenAt: "desc" },
        take: 3
      }
    }
  });

  if (!user) {
    return {
      logs: [],
      skipped: defaultChannels.map((channel) => ({ channel, reason: "user_not_found" }))
    };
  }

  const enabledChannels = await resolveEnabledChannels(prisma);
  const requestedChannels = input.channels?.length ? input.channels : enabledChannels;
  const channels = requestedChannels.filter((channel) => enabledChannels.includes(channel));
  const logs: NotificationLogSummary[] = [];
  const skipped: CreateNotificationLogsResult["skipped"] = [];

  for (const channel of channels) {
    const recipients = resolveRecipients(channel, user);

    if (recipients.length === 0) {
      skipped.push({ channel, reason: "missing_recipient" });
      continue;
    }

    const template = await resolveTemplate(prisma, {
      eventCode: input.eventCode,
      channel,
      clinicId: input.clinicId ?? null,
      locale: "en"
    });

    if (!template) {
      skipped.push({ channel, reason: "missing_template" });
      continue;
    }

    for (const recipient of recipients) {
      const variables = {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone
        },
        ...(input.variables ?? {})
      };
      const idempotencyKey = createNotificationIdempotencyKey({
        eventCode: input.eventCode,
        channel,
        userId: user.id,
        appointmentId: input.appointmentId,
        recipient,
        suffix: input.idempotencyKeySuffix
      });
      const existing = await prisma.notificationLog.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          channel: true,
          recipient: true,
          eventCode: true,
          idempotencyKey: true
        }
      });

      if (existing) {
        logs.push(existing);
        continue;
      }

      const log = await prisma.notificationLog.create({
        data: {
          userId: user.id,
          appointmentId: input.appointmentId ?? null,
          channel,
          eventCode: input.eventCode,
          idempotencyKey,
          recipient,
          subject: template.subject ? renderNotificationTemplate(template.subject, variables) : null,
          body: renderNotificationTemplate(template.body, variables),
          status: NotificationStatus.QUEUED,
          scheduledAt: input.scheduledAt ?? null
        },
        select: {
          id: true,
          channel: true,
          recipient: true,
          eventCode: true,
          idempotencyKey: true
        }
      });

      logs.push(log);
    }
  }

  return { logs, skipped };
}

export async function dispatchNotificationLog(
  prisma: PrismaClient,
  notificationLogId: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const prepared = await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationLog.updateMany({
      where: {
        id: notificationLogId,
        status: {
          in: [NotificationStatus.QUEUED, NotificationStatus.FAILED]
        },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }]
      },
      data: {
        status: NotificationStatus.PROCESSING,
        attempts: { increment: 1 },
        error: null
      }
    });

    if (updated.count === 0) {
      return null;
    }

    return tx.notificationLog.findUniqueOrThrow({
      where: { id: notificationLogId }
    });
  });

  if (!prepared) {
    return {
      processed: false,
      skipped: true,
      notificationLogId
    };
  }

  let providerName = "unresolved";

  try {
    const provider = createNotificationProvider(prepared.channel, env);
    providerName = provider.name;
    const result = await provider.send({
      notificationLogId: prepared.id,
      channel: prepared.channel,
      recipient: prepared.recipient,
      subject: prepared.subject,
      body: prepared.body,
      eventCode: prepared.eventCode
    });

    await prisma.notificationLog.update({
      where: { id: prepared.id },
      data: {
        status: NotificationStatus.SENT,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus ?? null,
        providerResponse: result.providerResponse ?? Prisma.DbNull,
        failureClassification: null,
        sentAt: new Date(),
        error: null
      }
    });

    return {
      processed: true,
      notificationLogId: prepared.id,
      status: "sent",
      provider: result.provider,
      providerMessageId: result.providerMessageId
    };
  } catch (error) {
    const deliveryError = toNotificationDeliveryError(error);

    await prisma.notificationLog.update({
      where: { id: prepared.id },
      data: {
        status: NotificationStatus.FAILED,
        provider: providerName,
        providerResponse: deliveryError.providerResponse ?? Prisma.DbNull,
        failureClassification: deliveryError.classification,
        error: deliveryError.message
      }
    });

    if (deliveryError.retryable) {
      throw deliveryError;
    }

    return {
      processed: true,
      notificationLogId: prepared.id,
      status: "failed",
      provider: providerName,
      retryable: false,
      failureClassification: deliveryError.classification
    };
  }
}

export function renderNotificationTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(variables, path);

    if (value === null || value === undefined) {
      return "";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value);
  });
}

function resolveRecipients(
  channel: NotificationChannel,
  user: {
    email: string | null;
    phone: string | null;
    pushTokens: Array<{ token: string }>;
  }
) {
  if (channel === NotificationChannel.EMAIL) {
    return user.email ? [user.email] : [];
  }

  if (channel === NotificationChannel.SMS) {
    return user.phone ? [user.phone] : [];
  }

  return user.pushTokens.map((pushToken) => pushToken.token);
}

async function resolveEnabledChannels(prisma: NotificationPrisma) {
  const setting = await prisma.systemSetting.findFirst({
    where: {
      scopeType: ScopeType.PLATFORM,
      scopeId: null,
      key: "notification.enabled_channels"
    },
    select: { value: true }
  });
  const channels =
    setting?.value && typeof setting.value === "object" && "channels" in setting.value
      ? (setting.value.channels as unknown)
      : null;

  if (!Array.isArray(channels)) {
    return defaultChannels;
  }

  return channels
    .map((channel) => parseChannel(channel))
    .filter((channel): channel is NotificationChannel => Boolean(channel));
}

async function resolveTemplate(
  prisma: NotificationPrisma,
  input: {
    eventCode: string;
    channel: NotificationChannel;
    clinicId: string | null;
    locale: string;
  }
) {
  const templates = await prisma.notificationTemplate.findMany({
    where: {
      eventCode: input.eventCode,
      channel: input.channel,
      locale: input.locale,
      isActive: true,
      OR: [
        ...(input.clinicId
          ? [{ scopeType: ScopeType.CLINIC, scopeId: input.clinicId }]
          : []),
        { scopeType: ScopeType.PLATFORM, scopeId: null }
      ]
    }
  });

  return (
    templates.find(
      (template) => template.scopeType === ScopeType.CLINIC && template.scopeId === input.clinicId
    ) ??
    templates.find((template) => template.scopeType === ScopeType.PLATFORM && !template.scopeId) ??
    null
  );
}

function parseChannel(value: unknown) {
  if (value === "email") {
    return NotificationChannel.EMAIL;
  }

  if (value === "sms") {
    return NotificationChannel.SMS;
  }

  if (value === "push") {
    return NotificationChannel.PUSH;
  }

  return null;
}

function createNotificationIdempotencyKey(input: {
  eventCode: string;
  channel: NotificationChannel;
  userId: string;
  appointmentId?: string | null;
  recipient: string;
  suffix?: string | null;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        eventCode: input.eventCode,
        channel: input.channel,
        userId: input.userId,
        appointmentId: input.appointmentId ?? null,
        recipient: input.recipient,
        suffix: input.suffix ?? null
      })
    )
    .digest("hex")
    .slice(0, 48);

  return `notification|${hash}`;
}

function getPath(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, source);
}
