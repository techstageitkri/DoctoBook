import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { json, urlencoded } from "express";
import { INestApplication } from "@nestjs/common";
import { ServerEnv } from "@doctobook/config";

type MiddlewareRequest = IncomingMessage & {
  id?: string;
};

type NextFunction = () => void;

export function configureRequestHardening(app: INestApplication, env: ServerEnv) {
  const express = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: boolean | number | string) => void;
  };

  express.set?.("trust proxy", env.API_TRUST_PROXY);

  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware(env));
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

function sanitizeRequestId(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed || !/^[a-zA-Z0-9._:-]{8,160}$/u.test(trimmed)) {
    return null;
  }

  return trimmed;
}
