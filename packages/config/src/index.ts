import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
const booleanEnvSchema = z
  .preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }

    return value;
  }, z.boolean())
  .optional();

const notificationEnvSchema = {
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM_EMAIL: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ZEPTOMAIL_API_KEY: z.string().optional(),
  ZEPTOMAIL_API_URL: z.string().url().optional(),
  SMS_PROVIDER: z.string().optional(),
  SMS_FROM_NUMBER: z.string().optional(),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_METHOD: z.string().optional(),
  SMS_HTTP_AUTH_HEADER: z.string().optional(),
  SMS_HTTP_AUTH_TOKEN: z.string().optional(),
  SMS_HTTP_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  PUSH_PROVIDER: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional()
};

const baseServerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_TOKEN_SECRET: z.string().min(16),
  JWT_REFRESH_TOKEN_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGINS: z.string().optional(),
  API_TRUST_PROXY: booleanEnvSchema.default(false),
  API_BODY_LIMIT: z.string().trim().min(1).default("1mb"),
  API_WEBHOOK_BODY_LIMIT: z.string().trim().min(1).default("256kb"),
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  API_RATE_LIMIT_DISABLED: booleanEnvSchema.default(false),
  API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  ...notificationEnvSchema
});

export const serverEnvSchema = baseServerEnvSchema
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.API_CORS_ORIGINS?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["API_CORS_ORIGINS"],
        message: "Production API requires an explicit CORS allowlist"
      });
    }
  });

export const workerEnvSchema = baseServerEnvSchema
  .omit({ API_HOST: true, API_PORT: true })
  .superRefine((value, context) => {
    addMissingProviderIssues(context, "EMAIL_PROVIDER", value.EMAIL_PROVIDER, {
      smtp: ["SMTP_HOST", ["EMAIL_FROM_EMAIL", "SMTP_FROM_EMAIL"]],
      sendgrid: ["SENDGRID_API_KEY", ["EMAIL_FROM_EMAIL", "SMTP_FROM_EMAIL"]],
      zeptomail: ["ZEPTOMAIL_API_KEY", ["EMAIL_FROM_EMAIL", "SMTP_FROM_EMAIL"]],
      zepto: ["ZEPTOMAIL_API_KEY", ["EMAIL_FROM_EMAIL", "SMTP_FROM_EMAIL"]]
    }, value);
    addMissingProviderIssues(context, "SMS_PROVIDER", value.SMS_PROVIDER, {
      twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
      http: ["SMS_HTTP_URL"],
      webhook: ["SMS_HTTP_URL"]
    }, value);

    const pushProvider = normalizeProvider(value.PUSH_PROVIDER);

    if (pushProvider === "firebase" || pushProvider === "fcm") {
      const hasServiceAccountJson = Boolean(value.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
      const hasIndividualFields =
        Boolean(value.FIREBASE_PROJECT_ID?.trim()) &&
        Boolean(value.FIREBASE_CLIENT_EMAIL?.trim()) &&
        Boolean(value.FIREBASE_PRIVATE_KEY?.trim());

      if (!hasServiceAccountJson && !hasIndividualFields) {
        context.addIssue({
          code: "custom",
          path: ["PUSH_PROVIDER"],
          message:
            "Firebase push requires FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY"
        });
      }
    }
  });

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_URL: z.string().url()
});

export type ServerEnv = z.output<typeof baseServerEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseServerEnv(env: NodeJS.ProcessEnv): ServerEnv {
  return serverEnvSchema.parse(env);
}

export function parseWorkerEnv(env: NodeJS.ProcessEnv): WorkerEnv {
  return workerEnvSchema.parse(env);
}

export function parseWebEnv(env: NodeJS.ProcessEnv): WebEnv {
  return webEnvSchema.parse(env);
}

type ProviderRequirements = Record<string, Array<string | string[]>>;

function addMissingProviderIssues(
  context: z.RefinementCtx,
  providerKey: string,
  providerValue: string | undefined,
  requirements: ProviderRequirements,
  env: Record<string, unknown>
) {
  const provider = normalizeProvider(providerValue);

  if (!provider || provider === "mock" || provider.startsWith("mock_")) {
    return;
  }

  const required = requirements[provider];

  if (!required) {
    context.addIssue({
      code: "custom",
      path: [providerKey],
      message: `Unsupported provider: ${provider}`
    });
    return;
  }

  for (const requirement of required) {
    if (Array.isArray(requirement)) {
      const hasAny = requirement.some((key) => hasEnvValue(env, key));

      if (!hasAny) {
        context.addIssue({
          code: "custom",
          path: [providerKey],
          message: `Provider ${provider} requires one of ${requirement.join(", ")}`
        });
      }
      continue;
    }

    if (!hasEnvValue(env, requirement)) {
      context.addIssue({
        code: "custom",
        path: [requirement],
        message: `Required when ${providerKey}=${provider}`
      });
    }
  }
}

function normalizeProvider(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasEnvValue(env: Record<string, unknown>, key: string) {
  const value = env[key];

  return typeof value === "string" ? Boolean(value.trim()) : value !== undefined && value !== null;
}
