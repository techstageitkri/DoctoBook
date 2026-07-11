import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import { NotificationChannel, NotificationStatus, ScopeType, UserStatus } from "@doctobook/database";
import { dispatchNotificationLog } from "@doctobook/notifications";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { NotificationModule } from "../src/notifications/notification.module.js";
import { NotificationService } from "../src/notifications/notification.service.js";

process.env.NODE_ENV ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.JWT_REFRESH_TOKEN_SECRET ??= "test-refresh-token-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

describeDatabase("notifications integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let notifications: NotificationService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, NotificationModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    notifications = moduleRef.get(NotificationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("creates idempotent notification logs and dispatches them", async () => {
    const eventCode = `test.notification.${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("notification"),
        fullName: "Notification Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    await prisma.notificationTemplate.create({
      data: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode,
        channel: NotificationChannel.EMAIL,
        locale: "en",
        subject: "Test {{user.fullName}}",
        body: "Body {{custom.value}}",
        isActive: true
      }
    });

    const first = await notifications.enqueueUserEvent({
      eventCode,
      userId: user.id,
      variables: { custom: { value: "one" } },
      idempotencyKeySuffix: "same"
    });
    const replay = await notifications.enqueueUserEvent({
      eventCode,
      userId: user.id,
      variables: { custom: { value: "two" } },
      idempotencyKeySuffix: "same"
    });
    const logs = await prisma.notificationLog.findMany({
      where: {
        eventCode,
        userId: user.id
      }
    });

    expect(first.logs).toHaveLength(1);
    expect(replay.logs).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.body).toBe("Body one");

    await dispatchNotificationLog(prisma, logs[0]!.id, {
      ...process.env,
      EMAIL_PROVIDER: "mock_email"
    });

    const dispatched = await prisma.notificationLog.findUniqueOrThrow({
      where: { id: logs[0]!.id }
    });

    expect(dispatched.status).toBe(NotificationStatus.SENT);
    expect(dispatched.provider).toBe("mock_email");
    expect(dispatched.providerStatus).toBe("mock_sent");
    expect(dispatched.failureClassification).toBeNull();
    expect(dispatched.attempts).toBe(1);
  });

  it("records permanent provider configuration failures without retrying", async () => {
    const eventCode = `test.notification.failure.${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("notification-failure"),
        fullName: "Notification Failure Patient",
        status: UserStatus.ACTIVE
      }
    });
    await prisma.notificationTemplate.create({
      data: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode,
        channel: NotificationChannel.EMAIL,
        locale: "en",
        subject: "Failure test",
        body: "Body",
        isActive: true
      }
    });

    await notifications.enqueueUserEvent({
      eventCode,
      userId: user.id
    });
    const log = await prisma.notificationLog.findFirstOrThrow({
      where: {
        eventCode,
        userId: user.id
      }
    });
    const result = await dispatchNotificationLog(prisma, log.id, {
      ...process.env,
      EMAIL_PROVIDER: "unsupported_email"
    });
    const failed = await prisma.notificationLog.findUniqueOrThrow({
      where: { id: log.id }
    });

    expect(result).toMatchObject({
      processed: true,
      status: "failed",
      retryable: false,
      failureClassification: "configuration"
    });
    expect(failed.status).toBe(NotificationStatus.FAILED);
    expect(failed.provider).toBe("unresolved");
    expect(failed.failureClassification).toBe("configuration");
    expect(failed.error).toContain("Unsupported");
  });
});
