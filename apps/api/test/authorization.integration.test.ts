import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PermissionEffect,
  ScopeType,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthenticatedUser } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { AuthorizationService } from "../src/authorization/authorization.service.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function asUser(id: string, roles: string[]): AuthenticatedUser {
  return {
    id,
    roles,
    sessionId: "authorization-test-session"
  };
}

describeDatabase("scoped authorization integration", () => {
  let moduleRef: TestingModule;
  let authorization: AuthorizationService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule]
    }).compile();
    await moduleRef.init();

    authorization = moduleRef.get(AuthorizationService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("allows clinic admins only inside their assigned clinic", async () => {
    const userId = await createUserWithRole("clinic-admin", "clinic_admin");
    const clinicId = await createClinic("allowed-clinic");
    const otherClinicId = await createClinic("blocked-clinic");

    await prisma.clinicAdmin.create({
      data: {
        userId,
        clinicId,
        status: ClinicAssociationStatus.APPROVED
      }
    });

    await expect(
      authorization.can(asUser(userId, ["clinic_admin"]), "clinic.read", {
        scope: "clinic",
        scopeId: clinicId
      })
    ).resolves.toBe(true);
    await expect(
      authorization.can(asUser(userId, ["clinic_admin"]), "clinic.read", {
        scope: "clinic",
        scopeId: otherClinicId
      })
    ).resolves.toBe(false);
  });

  it("gives explicit denies precedence over role grants", async () => {
    const userId = await createUserWithRole("clinic-admin-deny", "clinic_admin");
    const clinicId = await createClinic("denied-clinic");

    await prisma.clinicAdmin.create({
      data: {
        userId,
        clinicId,
        status: ClinicAssociationStatus.APPROVED
      }
    });
    await grantUserPermission(
      userId,
      "clinic.read",
      PermissionEffect.DENY,
      ScopeType.CLINIC,
      clinicId
    );

    await expect(
      authorization.can(asUser(userId, ["clinic_admin"]), "clinic.read", {
        scope: "clinic",
        scopeId: clinicId
      })
    ).resolves.toBe(false);
  });

  it("allows explicit scoped grants without leaking to another clinic", async () => {
    const userId = await createUserWithRole("patient-grant", "patient");
    const clinicId = await createClinic("grant-clinic");
    const otherClinicId = await createClinic("grant-other-clinic");

    await grantUserPermission(
      userId,
      "refund.approve",
      PermissionEffect.GRANT,
      ScopeType.CLINIC,
      clinicId
    );

    await expect(
      authorization.can(asUser(userId, ["patient"]), "refund.approve", {
        scope: "clinic",
        scopeId: clinicId
      })
    ).resolves.toBe(true);
    await expect(
      authorization.can(asUser(userId, ["patient"]), "refund.approve", {
        scope: "clinic",
        scopeId: otherClinicId
      })
    ).resolves.toBe(false);
  });

  it("supports self and doctor-clinic scopes", async () => {
    const doctorUserId = await createUserWithRole("doctor-user", "doctor");
    const otherUserId = await createUserWithRole("other-user", "patient");
    const clinicId = await createClinic("doctor-clinic");
    const locationId = await createClinicLocation(clinicId);
    const doctorId = await createDoctor(doctorUserId);
    const doctorClinicId = await createDoctorClinic(doctorId, clinicId, locationId);

    await expect(
      authorization.can(asUser(doctorUserId, ["doctor"]), "account.update", {
        scope: "self",
        scopeId: doctorUserId
      })
    ).resolves.toBe(true);
    await expect(
      authorization.can(asUser(doctorUserId, ["doctor"]), "account.update", {
        scope: "self",
        scopeId: otherUserId
      })
    ).resolves.toBe(false);
    await expect(
      authorization.can(asUser(doctorUserId, ["doctor"]), "doctor_clinic.request", {
        scope: "doctor_clinic",
        scopeId: doctorClinicId
      })
    ).resolves.toBe(true);
  });

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Authorization Test User",
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            roleId: role.id
          }
        }
      },
      select: { id: true }
    });

    return user.id;
  }

  async function createClinic(prefix: string) {
    const clinic = await prisma.clinic.create({
      data: {
        name: "Authorization Test Clinic",
        slug: `${prefix}-${randomUUID()}`,
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });

    return clinic.id;
  }

  async function createClinicLocation(clinicId: string) {
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId,
        address: "123 Authorization Street",
        city: "Colombo",
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });

    return location.id;
  }

  async function createDoctor(userId: string) {
    const doctor = await prisma.doctor.create({
      data: {
        userId,
        slug: `doctor-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      },
      select: { id: true }
    });

    return doctor.id;
  }

  async function createDoctorClinic(doctorId: string, clinicId: string, clinicLocationId: string) {
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId,
        clinicId,
        clinicLocationId,
        status: ClinicAssociationStatus.APPROVED
      },
      select: { id: true }
    });

    return doctorClinic.id;
  }

  async function grantUserPermission(
    userId: string,
    permissionCode: string,
    effect: PermissionEffect,
    scopeType: ScopeType,
    scopeId: string | null
  ) {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: permissionCode },
      select: { id: true }
    });

    await prisma.userPermissionGrant.create({
      data: {
        userId,
        permissionId: permission.id,
        effect,
        scopeType,
        scopeId
      }
    });
  }
});
