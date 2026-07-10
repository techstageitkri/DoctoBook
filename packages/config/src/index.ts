import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_TOKEN_SECRET: z.string().min(16),
  JWT_REFRESH_TOKEN_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),
  API_PORT: z.coerce.number().int().positive().default(4000)
});

export const workerEnvSchema = serverEnvSchema.omit({ API_PORT: true });

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_URL: z.string().url()
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
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
