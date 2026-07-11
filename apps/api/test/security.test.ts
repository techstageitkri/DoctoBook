import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@doctobook/config";
import { loginSchema } from "../src/auth/auth.schemas.js";
import { corsOrigins, isCorsOriginAllowed } from "../src/security/bootstrap-security.js";

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
  });

  it("rejects unknown request fields in auth schemas", () => {
    const result = loginSchema.safeParse({
      email: "patient@example.test",
      password: "Password123!",
      unexpected: "field"
    });

    expect(result.success).toBe(false);
  });
});
