import { Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";
import { APP_NAME } from "@doctobook/shared";
import { parseServerEnv } from "@doctobook/config";
import { PrismaService } from "../database/prisma.service.js";

type HealthCheck = {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
};

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly env = parseServerEnv(process.env);
  private readonly redis = new Redis(this.env.REDIS_URL, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  live() {
    return {
      app: APP_NAME,
      service: "api",
      status: "ok"
    };
  }

  async ready() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = database.status === "ok" && redis.status === "ok" ? "ok" : "error";
    const payload = {
      app: APP_NAME,
      service: "api",
      status,
      checks: {
        database,
        redis
      }
    };

    if (status !== "ok") {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: "ok",
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        status: "error",
        latencyMs: Date.now() - startedAt,
        error: this.safeError(error)
      };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const startedAt = Date.now();

    try {
      if (this.redis.status === "wait") {
        await this.redis.connect();
      }

      await this.redis.ping();

      return {
        status: "ok",
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        status: "error",
        latencyMs: Date.now() - startedAt,
        error: this.safeError(error)
      };
    }
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message : "Unknown dependency error";
  }
}
