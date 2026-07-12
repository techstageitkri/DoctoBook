import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

export type NotificationDeliveryOverride = {
  subject?: string | null;
  body?: string | null;
  sensitive?: boolean;
};

export type EncryptedNotificationDelivery = {
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
};

export type DispatchNotificationJob = {
  notificationLogId: string;
  encryptedDelivery?: EncryptedNotificationDelivery;
};

export type NotificationDispatch = {
  notificationLogId: string;
  delivery?: NotificationDeliveryOverride;
};

export type CreateNotificationEventInput = {
  eventCode: string;
  userId: string;
  appointmentId?: string | null;
  clinicId?: string | null;
  channels?: NotificationChannel[];
  variables?: Record<string, unknown>;
  sensitiveVariables?: Record<string, unknown>;
  idempotencyKeySuffix?: string | null;
  scheduledAt?: Date | null;
};

export type CreateRecipientEmailNotificationInput = {
  eventCode: string;
  recipientEmail: string;
  clinicId?: string | null;
  variables?: Record<string, unknown>;
  sensitiveVariables?: Record<string, unknown>;
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
  dispatches: NotificationDispatch[];
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
      dispatches: [],
      skipped: defaultChannels.map((channel) => ({ channel, reason: "user_not_found" }))
    };
  }

  const enabledChannels = await resolveEnabledChannels(prisma);
  const requestedChannels = input.channels?.length ? input.channels : enabledChannels;
  const channels = requestedChannels.filter((channel) => enabledChannels.includes(channel));
  const logs: NotificationLogSummary[] = [];
  const dispatches: NotificationDispatch[] = [];
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
      const deliveryVariables = mergeTemplateVariables(variables, input.sensitiveVariables);
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
        dispatches.push({
          notificationLogId: existing.id,
          delivery: input.sensitiveVariables
            ? {
                subject: template.subject
                  ? renderNotificationTemplate(template.subject, deliveryVariables)
                  : null,
                body: renderNotificationTemplate(template.body, deliveryVariables),
                sensitive: true
              }
            : undefined
        });
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
      dispatches.push({
        notificationLogId: log.id,
        delivery: input.sensitiveVariables
          ? {
              subject: template.subject
                ? renderNotificationTemplate(template.subject, deliveryVariables)
                : null,
              body: renderNotificationTemplate(template.body, deliveryVariables),
              sensitive: true
            }
          : undefined
      });
    }
  }

  return { logs, dispatches, skipped };
}

export async function createRecipientEmailNotificationLogs(
  prisma: NotificationPrisma,
  input: CreateRecipientEmailNotificationInput
): Promise<CreateNotificationLogsResult> {
  const channel = NotificationChannel.EMAIL;
  const enabledChannels = await resolveEnabledChannels(prisma);

  if (!enabledChannels.includes(channel)) {
    return {
      logs: [],
      dispatches: [],
      skipped: [{ channel, reason: "channel_disabled" }]
    };
  }

  const template = await resolveTemplate(prisma, {
    eventCode: input.eventCode,
    channel,
    clinicId: input.clinicId ?? null,
    locale: "en"
  });

  if (!template) {
    return {
      logs: [],
      dispatches: [],
      skipped: [{ channel, reason: "missing_template" }]
    };
  }

  const variables = input.variables ?? {};
  const deliveryVariables = mergeTemplateVariables(variables, input.sensitiveVariables);
  const idempotencyKey = createNotificationIdempotencyKey({
    eventCode: input.eventCode,
    channel,
    userId: input.recipientEmail,
    recipient: input.recipientEmail,
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
    return {
      logs: [existing],
      dispatches: [
        {
          notificationLogId: existing.id,
          delivery: input.sensitiveVariables
            ? {
                subject: template.subject
                  ? renderNotificationTemplate(template.subject, deliveryVariables)
                  : null,
                body: renderNotificationTemplate(template.body, deliveryVariables),
                sensitive: true
              }
            : undefined
        }
      ],
      skipped: []
    };
  }

  const log = await prisma.notificationLog.create({
    data: {
      channel,
      eventCode: input.eventCode,
      idempotencyKey,
      recipient: input.recipientEmail,
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

  return {
    logs: [log],
    dispatches: [
      {
        notificationLogId: log.id,
        delivery: input.sensitiveVariables
          ? {
              subject: template.subject
                ? renderNotificationTemplate(template.subject, deliveryVariables)
                : null,
              body: renderNotificationTemplate(template.body, deliveryVariables),
              sensitive: true
            }
          : undefined
      }
    ],
    skipped: []
  };
}

export async function dispatchNotificationLog(
  prisma: PrismaClient,
  notificationLogId: string,
  env: NodeJS.ProcessEnv = process.env,
  delivery?: NotificationDeliveryOverride
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
      subject: delivery?.subject ?? prepared.subject,
      body: delivery?.body ?? prepared.body,
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

export function encryptNotificationDelivery(
  delivery: NotificationDeliveryOverride,
  secret: string,
  aad?: string
): EncryptedNotificationDelivery {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", notificationEncryptionKey(secret), iv);

  if (aad) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(delivery), "utf8"),
    cipher.final()
  ]);

  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

export function decryptNotificationDelivery(
  encrypted: EncryptedNotificationDelivery,
  secret: string,
  aad?: string
): NotificationDeliveryOverride {
  if (encrypted.algorithm !== "aes-256-gcm") {
    throw new Error(`Unsupported notification delivery encryption: ${encrypted.algorithm}`);
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    notificationEncryptionKey(secret),
    Buffer.from(encrypted.iv, "base64url")
  );

  if (aad) {
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }

  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as NotificationDeliveryOverride;

  return {
    subject: parsed.subject ?? null,
    body: parsed.body ?? null,
    sensitive: parsed.sensitive === true
  };
}

function notificationEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
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

function mergeTemplateVariables(
  variables: Record<string, unknown>,
  sensitiveVariables?: Record<string, unknown>
) {
  if (!sensitiveVariables) {
    return variables;
  }

  return deepMerge(variables, sensitiveVariables);
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key];

    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = deepMerge(current, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
