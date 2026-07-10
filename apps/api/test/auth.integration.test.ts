import { randomUUID } from "node:crypto";
import { TestingModule, Test } from "@nestjs/testing";
import { UserStatus } from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../src/auth/auth.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";

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
  let moduleRef: TestingModule;
  let auth: AuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule]
    }).compile();
    await moduleRef.init();

    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
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
