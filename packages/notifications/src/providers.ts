import { createSign, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { NotificationChannel, Prisma } from "@doctobook/database";

export type NotificationFailureClassification =
  | "configuration"
  | "provider_rejected"
  | "provider_unavailable"
  | "rate_limited"
  | "network"
  | "unknown";

export type NotificationProviderInput = {
  notificationLogId: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string | null;
  body?: string | null;
  eventCode: string;
};

export type NotificationProviderResult = {
  provider: string;
  providerMessageId: string;
  providerStatus?: string | null;
  providerResponse?: Prisma.InputJsonValue;
};

export type NotificationProvider = {
  name: string;
  send(input: NotificationProviderInput): Promise<NotificationProviderResult>;
};

export type NotificationProviderHealth = {
  channel: "email" | "sms" | "push";
  provider: string;
  mode: "mock" | "production";
  ready: boolean;
  missing: string[];
};

export class NotificationDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly classification: NotificationFailureClassification,
    readonly providerResponse?: Prisma.InputJsonValue
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

type FirebaseAccessToken = {
  accessToken: string;
  expiresAt: number;
};

let firebaseAccessToken: FirebaseAccessToken | null = null;

export function createNotificationProvider(
  channel: NotificationChannel,
  env: NodeJS.ProcessEnv
): NotificationProvider {
  const code = providerCodeForChannel(channel, env);

  if (isMockProvider(code)) {
    return createMockProvider(code);
  }

  if (channel === NotificationChannel.EMAIL) {
    if (code === "smtp") {
      return createSmtpProvider(env);
    }

    if (code === "sendgrid") {
      return createSendGridProvider(env);
    }

    if (code === "zeptomail" || code === "zepto") {
      return createZeptoMailProvider(env);
    }
  }

  if (channel === NotificationChannel.SMS) {
    if (code === "twilio") {
      return createTwilioProvider(env);
    }

    if (code === "http" || code === "webhook") {
      return createHttpSmsProvider(env);
    }
  }

  if (channel === NotificationChannel.PUSH && (code === "firebase" || code === "fcm")) {
    return createFirebaseProvider(env);
  }

  throw new NotificationDeliveryError(
    `Unsupported ${channel.toLowerCase()} notification provider: ${code}`,
    false,
    "configuration",
    toJsonValue({ provider: code, channel: channel.toLowerCase() })
  );
}

export function getNotificationProviderHealth(
  env: NodeJS.ProcessEnv = process.env
): NotificationProviderHealth[] {
  const emailProvider = providerCodeForChannel(NotificationChannel.EMAIL, env);
  const smsProvider = providerCodeForChannel(NotificationChannel.SMS, env);
  const pushProvider = providerCodeForChannel(NotificationChannel.PUSH, env);

  return [
    {
      channel: "email",
      provider: emailProvider,
      mode: isMockProvider(emailProvider) ? "mock" : "production",
      missing: missingEmailProviderEnv(emailProvider, env),
      ready: missingEmailProviderEnv(emailProvider, env).length === 0
    },
    {
      channel: "sms",
      provider: smsProvider,
      mode: isMockProvider(smsProvider) ? "mock" : "production",
      missing: missingSmsProviderEnv(smsProvider, env),
      ready: missingSmsProviderEnv(smsProvider, env).length === 0
    },
    {
      channel: "push",
      provider: pushProvider,
      mode: isMockProvider(pushProvider) ? "mock" : "production",
      missing: missingPushProviderEnv(pushProvider, env),
      ready: missingPushProviderEnv(pushProvider, env).length === 0
    }
  ];
}

export function toNotificationDeliveryError(error: unknown): NotificationDeliveryError {
  if (error instanceof NotificationDeliveryError) {
    return error;
  }

  const metadata = errorMetadata(error);
  const statusCode = getStatusCode(error);
  const classification = classifyFailure(statusCode, metadata.code);
  const retryable = isRetryableFailure(statusCode, metadata.code ?? null, classification);
  const message = error instanceof Error ? error.message : "Notification delivery failed";

  return new NotificationDeliveryError(message, retryable, classification, toJsonValue(metadata));
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactSensitive(entry)
    ])
  );
}

function createMockProvider(code: string): NotificationProvider {
  return {
    name: code,
    async send(input) {
      return {
        provider: code,
        providerMessageId: `${code}-${randomUUID()}`,
        providerStatus: "mock_sent",
        providerResponse: toJsonValue({
          notificationLogId: input.notificationLogId,
          channel: input.channel.toLowerCase()
        })
      };
    }
  };
}

function createSmtpProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "smtp";

  return {
    name,
    async send(input) {
      const host = requiredEnv(env, "SMTP_HOST", name);
      const port = Number(env.SMTP_PORT ?? 587);
      const fromEmail = resolveEmailFrom(env);
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: parseBoolean(env.SMTP_SECURE, port === 465),
        auth:
          env.SMTP_USERNAME || env.SMTP_PASSWORD
            ? {
                user: requiredEnv(env, "SMTP_USERNAME", name),
                pass: requiredEnv(env, "SMTP_PASSWORD", name)
              }
            : undefined
      });

      try {
        const result = await transporter.sendMail({
          from: formatEmailAddress(fromEmail, resolveEmailFromName(env)),
          to: input.recipient,
          subject: input.subject ?? "",
          text: input.body ?? ""
        });

        return {
          provider: name,
          providerMessageId: result.messageId || `${name}-${randomUUID()}`,
          providerStatus: result.response ?? "accepted",
          providerResponse: toJsonValue({
            accepted: result.accepted,
            rejected: result.rejected,
            pending: result.pending,
            response: result.response
          })
        };
      } catch (error) {
        throw toNotificationDeliveryError(error);
      }
    }
  };
}

function createSendGridProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "sendgrid";

  return {
    name,
    async send(input) {
      const apiKey = requiredEnv(env, "SENDGRID_API_KEY", name);
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: input.recipient }] }],
          from: {
            email: resolveEmailFrom(env),
            name: resolveEmailFromName(env)
          },
          subject: input.subject ?? "",
          content: [{ type: "text/plain", value: input.body ?? "" }]
        })
      });

      return handleHttpProviderResponse(name, response, "x-message-id");
    }
  };
}

function createZeptoMailProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "zeptomail";

  return {
    name,
    async send(input) {
      const apiKey = requiredEnv(env, "ZEPTOMAIL_API_KEY", name);
      const response = await fetch(env.ZEPTOMAIL_API_URL ?? "https://api.zeptomail.com/v1.1/email", {
        method: "POST",
        headers: {
          Authorization: `Zoho-enczapikey ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: {
            address: resolveEmailFrom(env),
            name: resolveEmailFromName(env)
          },
          to: [
            {
              email_address: {
                address: input.recipient
              }
            }
          ],
          subject: input.subject ?? "",
          textbody: input.body ?? ""
        })
      });

      return handleHttpProviderResponse(name, response);
    }
  };
}

function createTwilioProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "twilio";

  return {
    name,
    async send(input) {
      const accountSid = requiredEnv(env, "TWILIO_ACCOUNT_SID", name);
      const authToken = requiredEnv(env, "TWILIO_AUTH_TOKEN", name);
      const from = requiredEnv(env, "TWILIO_FROM_NUMBER", name);
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            To: input.recipient,
            From: from,
            Body: input.body ?? ""
          })
        }
      );

      return handleHttpProviderResponse(name, response, "sid");
    }
  };
}

function createHttpSmsProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "http_sms";

  return {
    name,
    async send(input) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (env.SMS_HTTP_AUTH_HEADER && env.SMS_HTTP_AUTH_TOKEN) {
        headers[env.SMS_HTTP_AUTH_HEADER] = env.SMS_HTTP_AUTH_TOKEN;
      }

      const response = await fetch(requiredEnv(env, "SMS_HTTP_URL", name), {
        method: env.SMS_HTTP_METHOD ?? "POST",
        headers,
        body: JSON.stringify({
          to: input.recipient,
          from: env.SMS_FROM_NUMBER ?? env.SMS_HTTP_FROM ?? null,
          message: input.body ?? "",
          eventCode: input.eventCode,
          notificationLogId: input.notificationLogId
        })
      });

      return handleHttpProviderResponse(name, response);
    }
  };
}

function createFirebaseProvider(env: NodeJS.ProcessEnv): NotificationProvider {
  const name = "firebase";

  return {
    name,
    async send(input) {
      const serviceAccount = resolveFirebaseServiceAccount(env);
      const accessToken = await getFirebaseAccessToken(serviceAccount);
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: {
              token: input.recipient,
              notification: {
                title: input.subject ?? "DoctoBook",
                body: input.body ?? ""
              },
              data: {
                eventCode: input.eventCode,
                notificationLogId: input.notificationLogId
              }
            }
          })
        }
      );

      return handleHttpProviderResponse(name, response, "name");
    }
  };
}

async function handleHttpProviderResponse(
  provider: string,
  response: Response,
  messageIdKey?: string
): Promise<NotificationProviderResult> {
  const responseBody = await parseResponseBody(response);
  const responseJson = toJsonValue({
    status: response.status,
    statusText: response.statusText,
    body: responseBody
  });

  if (!response.ok) {
    throw new NotificationDeliveryError(
      `${provider} delivery failed with HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
      classifyFailure(response.status),
      responseJson
    );
  }

  return {
    provider,
    providerMessageId:
      (messageIdKey ? readNestedString(responseBody, messageIdKey) : null) ??
      response.headers.get("x-message-id") ??
      response.headers.get("x-request-id") ??
      `${provider}-${randomUUID()}`,
    providerStatus: String(response.status),
    providerResponse: responseJson
  };
}

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return truncate(text);
  }
}

async function getFirebaseAccessToken(serviceAccount: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000);

  if (firebaseAccessToken && firebaseAccessToken.expiresAt - 60 > now) {
    return firebaseAccessToken.accessToken;
  }

  const assertion = signFirebaseJwt(serviceAccount, now);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new NotificationDeliveryError(
      `firebase token request failed with HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
      classifyFailure(response.status),
      toJsonValue({ status: response.status, body })
    );
  }

  if (!body || typeof body !== "object" || !("access_token" in body)) {
    throw new NotificationDeliveryError(
      "firebase token response did not include an access token",
      true,
      "provider_unavailable",
      toJsonValue({ status: response.status, body })
    );
  }

  firebaseAccessToken = {
    accessToken: String((body as { access_token: unknown }).access_token),
    expiresAt: now + Number((body as { expires_in?: unknown }).expires_in ?? 3600)
  };

  return firebaseAccessToken.accessToken;
}

function signFirebaseJwt(serviceAccount: FirebaseServiceAccount, now: number) {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claim = base64UrlJson({
    iss: serviceAccount.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  });
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(serviceAccount.privateKey, "base64url");

  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function resolveFirebaseServiceAccount(env: NodeJS.ProcessEnv): FirebaseServiceAccount {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };

    return {
      projectId: requiredParsedValue(parsed.project_id, "FIREBASE_SERVICE_ACCOUNT_JSON.project_id"),
      clientEmail: requiredParsedValue(
        parsed.client_email,
        "FIREBASE_SERVICE_ACCOUNT_JSON.client_email"
      ),
      privateKey: normalizePrivateKey(
        requiredParsedValue(parsed.private_key, "FIREBASE_SERVICE_ACCOUNT_JSON.private_key")
      )
    };
  }

  return {
    projectId: requiredEnv(env, "FIREBASE_PROJECT_ID", "firebase"),
    clientEmail: requiredEnv(env, "FIREBASE_CLIENT_EMAIL", "firebase"),
    privateKey: normalizePrivateKey(requiredEnv(env, "FIREBASE_PRIVATE_KEY", "firebase"))
  };
}

function providerCodeForChannel(channel: NotificationChannel, env: NodeJS.ProcessEnv) {
  if (channel === NotificationChannel.EMAIL) {
    return normalizeProviderCode(env.EMAIL_PROVIDER, "mock_email");
  }

  if (channel === NotificationChannel.SMS) {
    return normalizeProviderCode(env.SMS_PROVIDER, "mock_sms");
  }

  return normalizeProviderCode(env.PUSH_PROVIDER, "mock_push");
}

function normalizeProviderCode(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).toLowerCase();
}

function isMockProvider(code: string) {
  return code === "mock" || code.startsWith("mock_");
}

function resolveEmailFrom(env: NodeJS.ProcessEnv) {
  return env.EMAIL_FROM_EMAIL ?? env.SMTP_FROM_EMAIL ?? requiredEnv(env, "SMTP_FROM_EMAIL", "email");
}

function resolveEmailFromName(env: NodeJS.ProcessEnv) {
  return env.EMAIL_FROM_NAME ?? env.SMTP_FROM_NAME ?? "DoctoBook";
}

function formatEmailAddress(email: string, name: string) {
  return name ? `"${name.replaceAll('"', "'")}" <${email}>` : email;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return value === "true" || value === "1";
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string, provider: string) {
  const value = env[key]?.trim();

  if (!value) {
    throw new NotificationDeliveryError(
      `${key} is required for ${provider} notification delivery`,
      false,
      "configuration",
      toJsonValue({ provider, missing: key })
    );
  }

  return value;
}

function requiredParsedValue(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new NotificationDeliveryError(
      `${path} is required for firebase notification delivery`,
      false,
      "configuration",
      toJsonValue({ provider: "firebase", missing: path })
    );
  }

  return value;
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function missingEmailProviderEnv(provider: string, env: NodeJS.ProcessEnv) {
  if (isMockProvider(provider)) {
    return [];
  }

  if (provider === "smtp") {
    return missing(env, ["SMTP_HOST"]).concat(resolveEmailFromMissing(env));
  }

  if (provider === "sendgrid") {
    return missing(env, ["SENDGRID_API_KEY"]).concat(resolveEmailFromMissing(env));
  }

  if (provider === "zeptomail" || provider === "zepto") {
    return missing(env, ["ZEPTOMAIL_API_KEY"]).concat(resolveEmailFromMissing(env));
  }

  return [`unsupported:${provider}`];
}

function missingSmsProviderEnv(provider: string, env: NodeJS.ProcessEnv) {
  if (isMockProvider(provider)) {
    return [];
  }

  if (provider === "twilio") {
    return missing(env, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
  }

  if (provider === "http" || provider === "webhook") {
    return missing(env, ["SMS_HTTP_URL"]);
  }

  return [`unsupported:${provider}`];
}

function missingPushProviderEnv(provider: string, env: NodeJS.ProcessEnv) {
  if (isMockProvider(provider)) {
    return [];
  }

  if (provider === "firebase" || provider === "fcm") {
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return [];
    }

    return missing(env, ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]);
  }

  return [`unsupported:${provider}`];
}

function resolveEmailFromMissing(env: NodeJS.ProcessEnv) {
  return env.EMAIL_FROM_EMAIL || env.SMTP_FROM_EMAIL ? [] : ["EMAIL_FROM_EMAIL"];
}

function missing(env: NodeJS.ProcessEnv, keys: string[]) {
  return keys.filter((key) => !env[key]?.trim());
}

function classifyFailure(
  statusCode?: number | null,
  code?: string | null
): NotificationFailureClassification {
  if (statusCode === 429) {
    return "rate_limited";
  }

  if (statusCode && statusCode >= 500) {
    return "provider_unavailable";
  }

  if (statusCode && statusCode >= 400) {
    return statusCode === 401 || statusCode === 403 ? "configuration" : "provider_rejected";
  }

  if (code && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"].includes(code)) {
    return "network";
  }

  return "unknown";
}

function isRetryableFailure(
  statusCode: number | null,
  code: string | null,
  classification: NotificationFailureClassification
) {
  if (classification === "network" || classification === "rate_limited") {
    return true;
  }

  if (statusCode && statusCode >= 500) {
    return true;
  }

  return Boolean(code && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"].includes(code));
}

function getStatusCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  const status = record.statusCode ?? record.status ?? record.responseCode;

  return typeof status === "number" ? status : null;
}

function errorMetadata(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const record = error as Record<string, unknown>;

  return {
    message: error instanceof Error ? error.message : "Notification delivery failed",
    name: error instanceof Error ? error.name : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    statusCode: getStatusCode(error)
  };
}

function readNestedString(source: unknown, path: string) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const value = path
    .split(".")
    .reduce<unknown>((current, key) =>
      current && typeof current === "object" ? (current as Record<string, unknown>)[key] : null,
    source);

  return typeof value === "string" && value ? value : null;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue;
}

function truncate(value: string) {
  return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
}

function isSensitiveKey(key: string) {
  return /authorization|password|token|secret|api.?key|private.?key|credential/i.test(key);
}
