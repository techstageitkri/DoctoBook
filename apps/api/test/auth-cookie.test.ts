import { describe, expect, it, vi } from "vitest";
import { AuthController } from "../src/auth/auth.controller.js";
import {
  refreshCookieName,
  refreshCookiePath,
  refreshTokenTtlMs
} from "../src/auth/auth.cookies.js";
import { RequestWithUser } from "../src/auth/auth.types.js";

const baseEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/doctobook",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_TOKEN_SECRET: "test-access-token-secret",
  JWT_REFRESH_TOKEN_SECRET: "test-refresh-token-secret",
  ENCRYPTION_KEY: "test-encryption-key",
  API_CORS_ORIGINS: "https://app.doctobook.test"
};

type CookieRecord = {
  name: string;
  value?: string;
  options: Record<string, unknown>;
};

async function withProductionEnv<T>(action: () => Promise<T> | T) {
  const previous = { ...process.env };
  Object.assign(process.env, baseEnv);

  try {
    return await action();
  } finally {
    process.env = previous;
  }
}

function responseRecorder() {
  const cookies: CookieRecord[] = [];
  const cleared: CookieRecord[] = [];
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.push({ name, value, options });
      return response;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared.push({ name, options });
      return response;
    }
  };

  return { response, cookies, cleared };
}

function request(cookie?: string): RequestWithUser {
  return {
    headers: cookie ? { cookie } : {},
    ip: "127.0.0.1",
    originalUrl: "/v1/auth/login",
    get: (name: string) => (name.toLowerCase() === "user-agent" ? "vitest" : undefined)
  };
}

function tokenResponse(refreshToken: string) {
  return {
    accessToken: "access-token",
    refreshToken,
    expiresInSeconds: 900,
    user: {
      id: "user-id",
      email: "patient@example.test",
      fullName: "Patient User",
      status: "ACTIVE",
      roles: ["patient"]
    }
  };
}

describe("browser auth cookies", () => {
  it("sets an HttpOnly refresh cookie on login without returning the refresh token", async () => {
    await withProductionEnv(async () => {
      const refreshToken = "r".repeat(48);
      const authService = {
        login: vi.fn().mockResolvedValue(tokenResponse(refreshToken))
      };
      const controller = new AuthController(authService as never);
      const { response, cookies } = responseRecorder();

      const result = await controller.login(
        {
          email: "patient@example.test",
          password: "Password123!",
          deviceName: "test"
        },
        request(),
        response as never
      );

      expect(result).toEqual({
        accessToken: "access-token",
        expiresInSeconds: 900,
        user: tokenResponse(refreshToken).user
      });
      expect(result).not.toHaveProperty("refreshToken");
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toEqual({
        name: refreshCookieName,
        value: refreshToken,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: refreshCookiePath,
          maxAge: refreshTokenTtlMs
        }
      });
    });
  });

  it("reads refresh tokens from cookies and rotates the cookie", async () => {
    await withProductionEnv(async () => {
      const oldRefreshToken = "o".repeat(48);
      const nextRefreshToken = "n".repeat(48);
      const authService = {
        refresh: vi.fn().mockResolvedValue(tokenResponse(nextRefreshToken))
      };
      const controller = new AuthController(authService as never);
      const { response, cookies } = responseRecorder();

      const result = await controller.refresh(
        {},
        request(`${refreshCookieName}=${oldRefreshToken}`),
        response as never
      );

      expect(authService.refresh).toHaveBeenCalledWith(
        { refreshToken: oldRefreshToken },
        {
          ipAddress: "127.0.0.1",
          userAgent: "vitest"
        }
      );
      expect(result).not.toHaveProperty("refreshToken");
      expect(cookies[0]?.value).toBe(nextRefreshToken);
    });
  });

  it("clears the refresh cookie on logout", async () => {
    await withProductionEnv(async () => {
      const refreshToken = "l".repeat(48);
      const authService = {
        logout: vi.fn().mockResolvedValue({ revoked: true })
      };
      const controller = new AuthController(authService as never);
      const { response, cleared } = responseRecorder();

      await expect(
        controller.logout(
          {},
          request(`${refreshCookieName}=${refreshToken}`),
          response as never
        )
      ).resolves.toEqual({ revoked: true });
      expect(authService.logout).toHaveBeenCalledWith(
        { refreshToken },
        {
          ipAddress: "127.0.0.1",
          userAgent: "vitest"
        }
      );
      expect(cleared[0]).toEqual({
        name: refreshCookieName,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: refreshCookiePath
        }
      });
    });
  });
});
