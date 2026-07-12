import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@doctobook/config";
import { loginSchema } from "../src/auth/auth.schemas.js";
import {
  corsOrigins,
  isCookieCsrfOriginAllowed,
  isCorsOriginAllowed
} from "../src/security/bootstrap-security.js";
import { SafeHttpExceptionFilter } from "../src/security/safe-http-exception.filter.js";

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/doctobook",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_TOKEN_SECRET: "test-access-token-secret",
  JWT_REFRESH_TOKEN_SECRET: "test-refresh-token-secret",
  ENCRYPTION_KEY: "test-encryption-key"
};

describe("security hardening", () => {
  it("requires explicit CORS origins in production", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv,
        NODE_ENV: "production"
      })
    ).toThrow("Production API requires an explicit CORS allowlist");
  });

  it("allows only configured CORS origins", () => {
    const env = parseServerEnv({
      ...baseEnv,
      NODE_ENV: "production",
      API_CORS_ORIGINS: "https://app.doctobook.test, https://admin.doctobook.test"
    });

    expect(corsOrigins(env)).toEqual([
      "https://app.doctobook.test",
      "https://admin.doctobook.test"
    ]);
    expect(isCorsOriginAllowed("https://app.doctobook.test", env)).toBe(true);
    expect(isCorsOriginAllowed("https://evil.example", env)).toBe(false);
    expect(isCorsOriginAllowed(undefined, env)).toBe(true);
    expect(isCookieCsrfOriginAllowed("https://app.doctobook.test", env)).toBe(true);
    expect(isCookieCsrfOriginAllowed("https://evil.example", env)).toBe(false);
    expect(isCookieCsrfOriginAllowed(undefined, env)).toBe(false);
  });

  it("rejects unknown request fields in auth schemas", () => {
    const result = loginSchema.safeParse({
      email: "patient@example.test",
      password: "Password123!",
      unexpected: "field"
    });

    expect(result.success).toBe(false);
  });

  it("preserves stable client error codes in safe exception responses", () => {
    let statusCode = 0;
    let responseBody: unknown;
    const filter = new SafeHttpExceptionFilter();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ id: "request-id", originalUrl: "/v1/auth/login" }),
        getResponse: () => ({
          status: (nextStatusCode: number) => {
            statusCode = nextStatusCode;

            return {
              json: (body: unknown) => {
                responseBody = body;
              }
            };
          }
        })
      })
    };

    filter.catch(
      new UnauthorizedException({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Email verification required"
      }),
      host as never
    );

    expect(statusCode).toBe(401);
    expect(responseBody).toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Email verification required"
    });
  });
});
