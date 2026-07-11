import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException
} from "@nestjs/common";
import { Redis } from "ioredis";
import { parseServerEnv } from "@doctobook/config";

type RateLimitedRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  originalUrl?: string;
  url?: string;
};

type RateLimitBucket = {
  name: string;
  windowSeconds: number;
  maxRequests: number;
};

class RateLimitExceededException extends HttpException {
  constructor() {
    super("Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly env = parseServerEnv(process.env);
  private readonly redis = new Redis(this.env.REDIS_URL, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const path = this.requestPath(request);

    if (this.env.API_RATE_LIMIT_DISABLED || this.isHealthPath(path)) {
      return true;
    }

    const bucket = this.resolveBucket(path);
    const key = this.keyFor(request, path, bucket);

    try {
      if (this.redis.status === "wait") {
        await this.redis.connect();
      }

      const count = await this.redis.incr(key);

      if (count === 1) {
        await this.redis.expire(key, bucket.windowSeconds);
      }

      if (count > bucket.maxRequests) {
        const retryAfterSeconds = await this.redis.ttl(key);
        const response = context.switchToHttp().getResponse<{
          setHeader?: (name: string, value: string) => void;
        }>();
        response.setHeader?.("Retry-After", String(Math.max(retryAfterSeconds, 1)));
        throw new RateLimitExceededException();
      }

      return true;
    } catch (error) {
      if (error instanceof RateLimitExceededException) {
        throw error;
      }

      if (this.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Rate limiter unavailable");
      }

      return true;
    }
  }

  private resolveBucket(path: string): RateLimitBucket {
    if (path.startsWith("/auth/")) {
      return {
        name: "auth",
        windowSeconds: this.env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
        maxRequests: this.env.AUTH_RATE_LIMIT_MAX
      };
    }

    if (path.startsWith("/v1/payments/webhooks/")) {
      return {
        name: "webhook",
        windowSeconds: this.env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
        maxRequests: this.env.WEBHOOK_RATE_LIMIT_MAX
      };
    }

    return {
      name: "api",
      windowSeconds: this.env.API_RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: this.env.API_RATE_LIMIT_MAX
    };
  }

  private keyFor(request: RateLimitedRequest, path: string, bucket: RateLimitBucket) {
    const method = request.method ?? "GET";
    const routeKey = bucket.name === "api" ? "all" : `${method}:${path}`;

    return `rate_limit:${bucket.name}:${this.clientIp(request)}:${routeKey}`;
  }

  private clientIp(request: RateLimitedRequest) {
    const forwardedFor = this.headerValue(request.headers["x-forwarded-for"]);
    const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();

    return firstForwardedIp || request.ip || "unknown";
  }

  private requestPath(request: RateLimitedRequest) {
    const url = request.originalUrl ?? request.url ?? "/";

    return url.split("?")[0] || "/";
  }

  private isHealthPath(path: string) {
    return path === "/health" || path.startsWith("/health/");
  }

  private headerValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }
}
