import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { json, urlencoded } from "express";
import { INestApplication } from "@nestjs/common";
import { ServerEnv } from "@doctobook/config";
import { JsonLogger } from "@doctobook/observability";
import { refreshCookieName } from "../auth/auth.cookies.js";
import { AuthenticatedUser } from "../auth/auth.types.js";

type MiddlewareRequest = IncomingMessage & {
  id?: string;
  originalUrl?: string;
  url?: string;
  user?: AuthenticatedUser;
};

type NextFunction = () => void;

export function configureRequestHardening(
  app: INestApplication,
  env: ServerEnv,
  logger?: JsonLogger
) {
  const express = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: boolean | number | string) => void;
  };

  express.set?.("trust proxy", env.API_TRUST_PROXY);

  app.use(requestIdMiddleware);
  if (logger) {
    app.use(requestLifecycleLogger(logger));
  }
  app.use(securityHeadersMiddleware(env));
  app.use(cookieAuthenticatedCsrfMiddleware(env));
  app.use("/v1/payments/webhooks", json({ limit: env.API_WEBHOOK_BODY_LIMIT }));
  app.use("/v1/payments/webhooks", urlencoded({ extended: false, limit: env.API_WEBHOOK_BODY_LIMIT }));
  app.use(json({ limit: env.API_BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: env.API_BODY_LIMIT }));
}

export function corsOrigins(env: ServerEnv) {
  const configured = env.API_CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) {
    return configured;
  }

  if (env.NODE_ENV === "production") {
    return [];
  }

  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

export function isCorsOriginAllowed(origin: string | undefined, env: ServerEnv) {
  if (!origin) {
    return true;
  }

  return corsOrigins(env).includes(origin);
}

export function isCookieCsrfOriginAllowed(origin: string | undefined, env: ServerEnv) {
  return Boolean(origin && corsOrigins(env).includes(origin));
}

function requestIdMiddleware(
  request: MiddlewareRequest,
  response: ServerResponse,
  next: NextFunction
) {
  const header = request.headers["x-request-id"];
  const requestId = sanitizeRequestId(Array.isArray(header) ? header[0] : header) ?? randomUUID();

  request.id = requestId;
  response.setHeader("x-request-id", requestId);
  next();
}

function requestLifecycleLogger(logger: JsonLogger) {
  return (request: MiddlewareRequest, response: ServerResponse, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const statusCode = response.statusCode;
      const context = {
        requestId: request.id ?? null,
        method: request.method ?? null,
        route: requestPath(request),
        statusCode,
        durationMs: Math.round(durationMs),
        userId: request.user?.id ?? null,
        role: request.user?.roles?.[0] ?? null
      };

      if (statusCode >= 500) {
        logger.error("api.request.completed", context);
        return;
      }

      if (statusCode >= 400) {
        logger.warn("api.request.completed", context);
        return;
      }

      logger.info("api.request.completed", context);
    });

    next();
  };
}

function securityHeadersMiddleware(env: ServerEnv) {
  return (_request: IncomingMessage, response: ServerResponse, next: NextFunction) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );

    if (env.NODE_ENV === "production") {
      response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    next();
  };
}

function cookieAuthenticatedCsrfMiddleware(env: ServerEnv) {
  return (request: MiddlewareRequest, response: ServerResponse, next: NextFunction) => {
    if (!isUnsafeMethod(request.method) || !hasRefreshCookie(request)) {
      next();
      return;
    }

    const origin = headerValue(request.headers.origin) ?? refererOrigin(request);

    if (isCookieCsrfOriginAllowed(origin, env)) {
      next();
      return;
    }

    response.statusCode = 403;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        statusCode: 403,
        code: "CSRF_ORIGIN_DENIED",
        message: "Cross-site cookie request rejected",
        requestId: request.id ?? null
      })
    );
  };
}

function sanitizeRequestId(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed || !/^[a-zA-Z0-9._:-]{8,160}$/u.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function isUnsafeMethod(method: string | undefined) {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
}

function requestPath(request: MiddlewareRequest) {
  const url = request.originalUrl ?? request.url ?? "/";

  return url.split("?")[0] || "/";
}

function hasRefreshCookie(request: MiddlewareRequest) {
  return Boolean(
    headerValue(request.headers.cookie)
      ?.split(";")
      .some((cookie) => cookie.trim().startsWith(`${refreshCookieName}=`))
  );
}

function refererOrigin(request: MiddlewareRequest) {
  const referer = headerValue(request.headers.referer);

  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
