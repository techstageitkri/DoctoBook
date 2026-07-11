import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  NotificationChannel,
  PaymentMode,
  PaymentStatus,
  RefundStatus,
  ScopeType,
  UserStatus
} from "@doctobook/database";
import { REFUND_PROCESSING_QUEUE_NAME, ProcessRefundJob } from "@doctobook/payments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { RefundModule } from "../src/refunds/refund.module.js";
import { RefundRecoveryService } from "../src/refunds/refund.service.js";

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

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function actor(id: string, roles: string[]): AuthenticatedUser {
  return {
    id,
    roles,
    sessionId: "refund-test-session"
  };
}

describeDatabase("refund recovery integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refunds: RefundRecoveryService;
  let queue: Queue<ProcessRefundJob>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, RefundModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    refunds = moduleRef.get(RefundRecoveryService);
    queue = new Queue<ProcessRefundJob>(REFUND_PROCESSING_QUEUE_NAME, {
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379"
      }
    });
    await ensureRefundPermissions();
    await ensureRefundNotificationTemplate();
  });

  afterAll(async () => {
    await queue?.close();
    await moduleRef?.close();
  });

  it("retries failed refunds by reusing the same refund record and queue job", async () => {
    const fixture = await createRefundFixture("refund-retry", {
      status: RefundStatus.FAILED
    });

    const response = await refunds.retryRefund(fixture.superAdmin, fixture.refundId, context);
    const stored = await prisma.refund.findUniqueOrThrow({ where: { id: fixture.refundId } });
    const history = await prisma.refundStatusHistory.findMany({
      where: { refundId: fixture.refundId },
      orderBy: { createdAt: "asc" }
    });
    const job = await queue.getJob(`refund-processing|${fixture.refundId}`);

    expect(response.queued).toBe(true);
    expect(response.duplicate).toBe(false);
    expect(response.refund.status).toBe("requested");
    expect(stored.status).toBe(RefundStatus.REQUESTED);
    expect(stored.retryCount).toBe(1);
    expect(history.at(-1)).toEqual(
      expect.objectContaining({
        fromStatus: RefundStatus.FAILED,
        toStatus: RefundStatus.REQUESTED,
        actorUserId: fixture.superAdmin.id
      })
    );
    expect(job?.data).toEqual({ refundId: fixture.refundId });

    const repeated = await refunds.retryRefund(fixture.superAdmin, fixture.refundId, context);
    const afterRepeated = await prisma.refund.findUniqueOrThrow({
      where: { id: fixture.refundId }
    });

    expect(repeated.duplicate).toBe(true);
    expect(afterRepeated.retryCount).toBe(1);
  });

  it("does not retry already completed refunds", async () => {
    const fixture = await createRefundFixture("refund-retry-processed", {
      status: RefundStatus.PROCESSED,
      providerRefundId: `processed-${randomUUID()}`
    });

    await expect(refunds.retryRefund(fixture.superAdmin, fixture.refundId, context)).rejects.toThrow(
      "Refund cannot be retried from its current status"
    );
  });

  it("manually completes failed refunds with history, audit, and patient notification", async () => {
    const fixture = await createRefundFixture("refund-manual", {
      status: RefundStatus.FAILED,
      amountMinor: 30000n
    });
    const beforeNotifications = await prisma.notificationLog.count({
      where: {
        eventCode: "refund.completed",
        appointmentId: fixture.appointmentId
      }
    });

    const response = await refunds.markRefundManual(
      fixture.superAdmin,
      fixture.refundId,
      {
        providerReference: "PAYHERE-REFUND-12345",
        reason: "Refund completed manually in merchant portal",
        refundedAt: "2026-07-11T10:30:00.000Z"
      },
      context
    );
    const stored = await prisma.refund.findUniqueOrThrow({ where: { id: fixture.refundId } });
    const history = await prisma.refundStatusHistory.findMany({
      where: { refundId: fixture.refundId },
      orderBy: { createdAt: "asc" }
    });
    const audits = await prisma.auditLog.findMany({
      where: {
        actionCode: "refund.manual_complete",
        entityId: fixture.refundId
      }
    });
    const afterNotifications = await prisma.notificationLog.count({
      where: {
        eventCode: "refund.completed",
        appointmentId: fixture.appointmentId
      }
    });

    expect(response.refund.status).toBe("processed");
    expect(stored.status).toBe(RefundStatus.PROCESSED);
    expect(stored.providerRefundId).toBe("PAYHERE-REFUND-12345");
    expect(stored.providerStatus).toBe("manual_completed");
    expect(stored.resolutionAction).toBe("manual_completed");
    expect(history.at(-1)).toEqual(
      expect.objectContaining({
        fromStatus: RefundStatus.FAILED,
        toStatus: RefundStatus.PROCESSED,
        actorUserId: fixture.superAdmin.id
      })
    );
    expect(audits).toHaveLength(1);
    expect(afterNotifications).toBe(beforeNotifications + 1);
  });

  it("requires a manual provider reference and reason", async () => {
    const fixture = await createRefundFixture("refund-manual-required", {
      status: RefundStatus.FAILED
    });

    await expect(
      refunds.markRefundManual(
        fixture.superAdmin,
        fixture.refundId,
        {
          providerReference: "",
          reason: ""
        },
        context
      )
    ).rejects.toThrow("Provider reference and reason are required");
  });

  it("prevents manual completion when total refunds would exceed the payment", async () => {
    const fixture = await createRefundFixture("refund-overage", {
      status: RefundStatus.FAILED,
      amountMinor: 10000n
    });
    await prisma.refund.create({
      data: {
        appointmentId: fixture.appointmentId,
        paymentId: fixture.paymentId,
        requestedByUserId: fixture.patientUserId,
        provider: "payhere",
        providerRefundId: `existing-${randomUUID()}`,
        amountMinor: 95000n,
        currency: "LKR",
        status: RefundStatus.PROCESSED,
        reason: "Existing processed refund",
        processedAt: new Date()
      }
    });

    await expect(
      refunds.markRefundManual(
        fixture.superAdmin,
        fixture.refundId,
        {
          providerReference: "MANUAL-OVERAGE",
          reason: "Should fail"
        },
        context
      )
    ).rejects.toThrow("Refund total exceeds successful payment amount");
  });

  it("moves uncertain refunds to reconciliation and then allows an audited retry", async () => {
    const fixture = await createRefundFixture("refund-reconciliation", {
      status: RefundStatus.FAILED,
      providerResponse: {
        providerStatus: "timeout",
        token: "secret-token"
      }
    });

    const reconciliation = await refunds.markRefundReconciliation(
      fixture.superAdmin,
      fixture.refundId,
      {
        reason: "Provider status could not be verified",
        notes: "Merchant portal must be checked manually",
        providerResponse: {
          token: "new-secret",
          status: "unknown"
        }
      },
      context
    );

    expect(reconciliation.refund.status).toBe("reconciliation_required");
    expect(reconciliation.refund.reconciliation.assignedTo?.id).toBe(fixture.superAdmin.id);
    expect(reconciliation.refund.providerResponse).toEqual({
      token: "[redacted]",
      status: "unknown"
    });

    const retry = await refunds.retryRefund(fixture.superAdmin, fixture.refundId, context);
    expect(retry.refund.status).toBe("requested");
    expect(retry.refund.retryCount).toBe(1);
    expect(retry.refund.reconciliation.resolutionAction).toBe("retry_requested");
  });

  it("keeps clinic refund visibility scoped and redacts provider responses", async () => {
    const fixture = await createRefundFixture("refund-scope", {
      status: RefundStatus.FAILED,
      providerResponse: {
        token: "payment-token",
        nested: {
          signature: "provider-signature",
          status: "failed"
        }
      }
    });
    const clinicAdmin = await createClinicAdmin("refund-scope-admin", fixture.clinicId);
    const otherClinic = await createClinic("refund-scope-other");

    const clinicResponse = await refunds.listClinicRefunds(clinicAdmin, fixture.clinicId, {
      limit: 50
    });
    const detail = await refunds.getAdminRefund(fixture.superAdmin, fixture.refundId);

    expect(clinicResponse.refunds.map((refund) => refund.id)).toContain(fixture.refundId);
    expect(detail.refund.providerResponse).toEqual({
      token: "[redacted]",
      nested: {
        signature: "[redacted]",
        status: "failed"
      }
    });
    await expect(
      refunds.listClinicRefunds(clinicAdmin, otherClinic.clinicId, { limit: 50 })
    ).rejects.toThrow("Missing required permission");
  });

  async function createRefundFixture(
    prefix: string,
    options: {
      status: RefundStatus;
      amountMinor?: bigint;
      paymentAmountMinor?: bigint;
      providerRefundId?: string | null;
      providerResponse?: unknown;
    }
  ) {
    const superAdminUser = await createRoleUser(`${prefix}-super`, "super_admin");
    const patientUser = await createRoleUser(`${prefix}-patient`, "patient");
    const patient = await prisma.patient.create({
      data: {
        userId: patientUser.id
      }
    });
    const doctorUser = await createRoleUser(`${prefix}-doctor`, "doctor");
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug(`${prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const clinic = await createClinic(`${prefix}-clinic`);
    const service = await prisma.service.create({
      data: {
        name: `Refund Consultation ${prefix}`,
        slug: uniqueSlug(`${prefix}-service`),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId: clinic.clinicId,
        serviceId: service.id,
        isActive: true
      }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        status: ClinicAssociationStatus.APPROVED,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: options.paymentAmountMinor ?? 100000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        isActive: true
      }
    });
    const startsAt = new Date(Date.UTC(2026, 6, 20, 4, 30, 0, 0));
    startsAt.setUTCMinutes(startsAt.getUTCMinutes() + Math.floor(Math.random() * 100000));
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt,
        endsAt,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        serviceNameSnapshot: "Refund Consultation",
        serviceDurationMinutes: 30,
        feeMinor: options.paymentAmountMinor ?? 100000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Refund Patient",
        createdByUserId: patientUser.id
      }
    });
    const payment = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        provider: "payhere",
        providerPaymentId: `payment-${randomUUID()}`,
        amountMinor: options.paymentAmountMinor ?? 100000n,
        currency: "LKR",
        status: PaymentStatus.SUCCESSFUL,
        paymentMethod: "card",
        paidAt: new Date()
      }
    });
    const refund = await prisma.refund.create({
      data: {
        appointmentId: appointment.id,
        paymentId: payment.id,
        requestedByUserId: patientUser.id,
        provider: "payhere",
        providerRefundId: options.providerRefundId,
        providerResponse:
          options.providerResponse === undefined
            ? undefined
            : (JSON.parse(JSON.stringify(options.providerResponse)) as object),
        amountMinor: options.amountMinor ?? 25000n,
        currency: "LKR",
        status: options.status,
        reason: "Refund recovery test",
        processedAt:
          options.status === RefundStatus.PROCESSED || options.status === RefundStatus.FAILED
            ? new Date()
            : null
      }
    });

    return {
      superAdmin: actor(superAdminUser.id, ["super_admin"]),
      patientUserId: patientUser.id,
      patientId: patient.id,
      clinicId: clinic.clinicId,
      appointmentId: appointment.id,
      paymentId: payment.id,
      refundId: refund.id
    };
  }

  async function createClinic(prefix: string) {
    const clinic = await prisma.clinic.create({
      data: {
        name: `Refund Clinic ${prefix}`,
        slug: uniqueSlug(prefix),
        status: ClinicStatus.ACTIVE
      }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        name: "Main",
        address: "1 Refund Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });

    return {
      clinicId: clinic.id,
      locationId: location.id
    };
  }

  async function createClinicAdmin(prefix: string, clinicId: string) {
    const user = await createRoleUser(prefix, "clinic_admin");
    await prisma.clinicAdmin.create({
      data: {
        clinicId,
        userId: user.id,
        status: ClinicAssociationStatus.APPROVED
      }
    });

    return actor(user.id, ["clinic_admin"]);
  }

  async function createRoleUser(prefix: string, roleCode: string) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: {
        code: roleCode,
        name: roleCode,
        isSystem: true
      }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: `Refund ${roleCode}`,
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            roleId: role.id
          }
        }
      }
    });

    return user;
  }

  async function ensureRefundPermissions() {
    const permissions = await Promise.all([
      prisma.permission.upsert({
        where: { code: "payment.read" },
        update: {},
        create: {
          code: "payment.read",
          module: "payment",
          description: "Read payment records."
        }
      }),
      prisma.permission.upsert({
        where: { code: "refund.process" },
        update: {},
        create: {
          code: "refund.process",
          module: "refund",
          description: "Mark gateway refund processing state."
        }
      })
    ]);
    const superAdminRole = await prisma.role.upsert({
      where: { code: "super_admin" },
      update: {},
      create: {
        code: "super_admin",
        name: "super_admin",
        isSystem: true
      }
    });
    const clinicAdminRole = await prisma.role.upsert({
      where: { code: "clinic_admin" },
      update: {},
      create: {
        code: "clinic_admin",
        name: "clinic_admin",
        isSystem: true
      }
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: superAdminRole.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: superAdminRole.id,
          permissionId: permission.id
        }
      });
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: clinicAdminRole.id,
          permissionId: permissions[0].id
        }
      },
      update: {},
      create: {
        roleId: clinicAdminRole.id,
        permissionId: permissions[0].id
      }
    });
  }

  async function ensureRefundNotificationTemplate() {
    const existing = await prisma.notificationTemplate.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode: "refund.completed",
        channel: NotificationChannel.EMAIL,
        locale: "en"
      },
      select: { id: true }
    });

    if (existing) {
      await prisma.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          subject: "Refund completed",
          body: "Your refund has been completed.",
          isActive: true
        }
      });
      return;
    }

    await prisma.notificationTemplate.create({
      data: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode: "refund.completed",
        channel: NotificationChannel.EMAIL,
        locale: "en",
        subject: "Refund completed",
        body: "Your refund has been completed.",
        isActive: true
      }
    });
  }
});
