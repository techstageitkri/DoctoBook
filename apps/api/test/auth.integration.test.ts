import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NotificationChannel, ScopeType, UserStatus } from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../src/auth/auth.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { SafeHttpExceptionFilter } from "../src/security/safe-http-exception.filter.js";

process.env.NODE_ENV ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.JWT_REFRESH_TOKEN_SECRET ??= "test-refresh-token-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const context: RequestContext = {
  ipAddress: "127.0.0.1",
  userAgent: "vitest"
};

function testEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function asAuthenticatedUser(
  response: Awaited<ReturnType<AuthService["login"]>>,
  sessionId = "test-session"
): AuthenticatedUser {
  return {
    id: response.user.id,
    roles: response.user.roles,
    sessionId
  };
}

async function registerVerifiedPatient(auth: AuthService, password = "Password123!") {
  const registration = await auth.register(
    {
      accountType: "patient",
      email: testEmail("patient"),
      fullName: "Auth Test Patient",
      password
    },
    context
  );

  expect(registration.verificationToken).toEqual(expect.any(String));
  await auth.verifyEmail({ token: registration.verificationToken as string }, context);

  return {
    email: registration.user.email as string,
    password,
    userId: registration.user.id
  };
}

describeDatabase("auth/session integration", () => {
  let app: INestApplication;
  let httpBaseUrl: string;
  let auth: AuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new SafeHttpExceptionFilter());
    await app.listen(0, "127.0.0.1");

    const address = app.getHttpServer().address() as AddressInfo;
    httpBaseUrl = `http://127.0.0.1:${address.port}`;
    auth = app.get(AuthService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("requires email verification after a valid password and returns a stable code", async () => {
    const password = "Password123!";
    const registration = await auth.register(
      {
        accountType: "patient",
        email: testEmail("pending-login"),
        fullName: "Pending Patient",
        password
      },
      context
    );

    await expect(
      auth.login({ email: registration.user.email as string, password: "WrongPassword123!" }, context)
    ).rejects.toThrow("Invalid credentials");

    try {
      await auth.login({ email: registration.user.email as string, password }, context);
      throw new Error("Login should have required email verification");
    } catch (error) {
      expect(error).toMatchObject({
        response: {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Email verification required"
        }
      });
    }
  });

  it("returns EMAIL_VERIFICATION_REQUIRED through the HTTP exception filter", async () => {
    const password = "Password123!";
    const registration = await auth.register(
      {
        accountType: "patient",
        email: testEmail("pending-http-login"),
        fullName: "Pending HTTP Patient",
        password
      },
      context
    );
    const response = await fetch(`${httpBaseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: registration.user.email,
        password
      })
    });
    const payload = (await response.json()) as { code?: string; message?: string };

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Email verification required"
    });
  });

  it("resends email verification with a new token and invalidates the previous unused token", async () => {
    const registration = await auth.register(
      {
        accountType: "patient",
        email: testEmail("resend"),
        fullName: "Resend Patient",
        password: "Password123!"
      },
      context
    );
    const oldToken = registration.verificationToken as string;

    await prisma.verificationToken.updateMany({
      where: {
        userId: registration.user.id,
        purpose: "email_verification",
        usedAt: null
      },
      data: {
        createdAt: new Date(Date.now() - 120_000)
      }
    });

    const resend = await auth.requestEmailVerification(
      { email: registration.user.email as string },
      context
    );

    expect(resend).toEqual({
      sent: true,
      verificationToken: expect.any(String)
    });
    expect(resend.verificationToken).not.toEqual(oldToken);
    await expect(auth.verifyEmail({ token: oldToken }, context)).rejects.toThrow(
      "Invalid verification token"
    );
    await expect(
      auth.verifyEmail({ token: resend.verificationToken as string }, context)
    ).resolves.toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ status: UserStatus.ACTIVE })
      })
    );
  });

  it("hides production verification tokens from API responses and notification logs", async () => {
    await prisma.notificationTemplate.upsert({
      where: {
        scopeType_scopeId_eventCode_channel_locale: {
          scopeType: ScopeType.PLATFORM,
          scopeId: null,
          eventCode: "auth.email_verification",
          channel: NotificationChannel.EMAIL,
          locale: "en"
        }
      },
      update: {
        subject: "Verify",
        body: "Verify at {{verification.url}} with fallback {{verification.token}}",
        isActive: true
      },
      create: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode: "auth.email_verification",
        channel: NotificationChannel.EMAIL,
        locale: "en",
        subject: "Verify",
        body: "Verify at {{verification.url}} with fallback {{verification.token}}",
        isActive: true
      }
    });

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.API_CORS_ORIGINS ??= "https://doctobook.example.test";
    process.env.WEB_PUBLIC_URL = "https://doctobook.example.test";

    try {
      const registration = await auth.register(
        {
          accountType: "patient",
          email: testEmail("production-hidden"),
          fullName: "Production Hidden Patient",
          password: "Password123!"
        },
        context
      );

      expect(registration.verificationToken).toBeUndefined();

      const log = await prisma.notificationLog.findFirstOrThrow({
        where: {
          userId: registration.user.id,
          eventCode: "auth.email_verification"
        },
        orderBy: { createdAt: "desc" }
      });

      expect(log.body).toContain("[redacted]");
      expect(log.body).not.toContain("token=");
    } finally {
      if (previousNodeEnv) {
        process.env.NODE_ENV = previousNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    }
  });

  it("registers, verifies email, logs in, and rejects reused refresh tokens", async () => {
    const account = await registerVerifiedPatient(auth);

    const login = await auth.login(
      {
        email: account.email,
        password: account.password,
        deviceName: "first browser"
      },
      context
    );
    const refreshed = await auth.refresh({ refreshToken: login.refreshToken }, context);

    expect(refreshed.refreshToken).not.toEqual(login.refreshToken);
    await expect(auth.refresh({ refreshToken: login.refreshToken }, context)).rejects.toThrow(
      "Invalid refresh token"
    );
  });

  it("revokes only the selected session on logout", async () => {
    const account = await registerVerifiedPatient(auth);
    const first = await auth.login(
      { email: account.email, password: account.password, deviceName: "first browser" },
      context
    );
    const second = await auth.login(
      { email: account.email, password: account.password, deviceName: "second browser" },
      context
    );

    await expect(auth.logout({ refreshToken: first.refreshToken }, context)).resolves.toEqual({
      revoked: true
    });
    await expect(auth.refresh({ refreshToken: first.refreshToken }, context)).rejects.toThrow(
      "Invalid refresh token"
    );
    await expect(auth.refresh({ refreshToken: second.refreshToken }, context)).resolves.toEqual(
      expect.objectContaining({
        refreshToken: expect.any(String)
      })
    );
  });

  it("revokes every active session on logout-all", async () => {
    const account = await registerVerifiedPatient(auth);
    const login = await auth.login({ email: account.email, password: account.password }, context);

    await expect(auth.logoutAll(asAuthenticatedUser(login), context)).resolves.toEqual({
      revokedSessions: expect.any(Number)
    });
    await expect(auth.refresh({ refreshToken: login.refreshToken }, context)).rejects.toThrow(
      "Invalid refresh token"
    );
  });

  it("blocks suspended users from authenticating", async () => {
    const account = await registerVerifiedPatient(auth);

    await prisma.user.update({
      where: { id: account.userId },
      data: { status: UserStatus.SUSPENDED }
    });

    await expect(
      auth.login({ email: account.email, password: account.password }, context)
    ).rejects.toThrow("Invalid credentials");
  });

  it("revokes sessions after password change", async () => {
    const oldPassword = "Password123!";
    const newPassword = "NewPassword123!";
    const account = await registerVerifiedPatient(auth, oldPassword);
    const login = await auth.login({ email: account.email, password: oldPassword }, context);

    await auth.changePassword(
      asAuthenticatedUser(login),
      {
        currentPassword: oldPassword,
        newPassword
      },
      context
    );

    await expect(auth.refresh({ refreshToken: login.refreshToken }, context)).rejects.toThrow(
      "Invalid refresh token"
    );
    await expect(
      auth.login({ email: account.email, password: oldPassword }, context)
    ).rejects.toThrow("Invalid credentials");
    await expect(
      auth.login({ email: account.email, password: newPassword }, context)
    ).resolves.toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String)
      })
    );
  });
});
