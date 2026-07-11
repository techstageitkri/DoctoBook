import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditModule } from "../src/audit/audit.module.js";
import { AvailabilityModule } from "../src/availability/availability.module.js";
import { DoctorAvailabilityService } from "../src/availability/availability.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
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

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function asUser(id: string, roles: string[]): AuthenticatedUser {
  return {
    id,
    roles,
    sessionId: "availability-test-session"
  };
}

describeDatabase("doctor availability integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let availability: DoctorAvailabilityService;
  let superAdmin: AuthenticatedUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuditModule, AuthorizationModule, AvailabilityModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    availability = moduleRef.get(DoctorAvailabilityService);
    superAdmin = asUser(await createUserWithRole("availability-super-admin", "super_admin"), [
      "super_admin"
    ]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("accepts split schedules inside clinic operating hours", async () => {
    const clinic = await createClinicWithLocation("split-schedule");
    await createClinicHour(clinic.locationId, 1, "09:00", "13:00");
    await createClinicHour(clinic.locationId, 1, "14:00", "18:00");
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);

    await availability.createClinicAvailabilityRule(
      superAdmin,
      clinic.clinicId,
      association.id,
      availabilityInput({ dayOfWeek: 1, startsAt: "09:00", endsAt: "13:00" }),
      context
    );
    await availability.createClinicAvailabilityRule(
      superAdmin,
      clinic.clinicId,
      association.id,
      availabilityInput({ dayOfWeek: 1, startsAt: "14:00", endsAt: "18:00" }),
      context
    );

    const listed = await availability.listClinicAvailability(
      superAdmin,
      clinic.clinicId,
      association.id
    );

    expect(listed.availabilityRules).toHaveLength(2);
  });

  it("rejects overlapping doctor schedules", async () => {
    const clinic = await createClinicWithLocation("overlap-schedule");
    await createClinicHour(clinic.locationId, 2, "09:00", "18:00");
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);

    await availability.createClinicAvailabilityRule(
      superAdmin,
      clinic.clinicId,
      association.id,
      availabilityInput({ dayOfWeek: 2, startsAt: "09:00", endsAt: "13:00" }),
      context
    );

    await expect(
      availability.createClinicAvailabilityRule(
        superAdmin,
        clinic.clinicId,
        association.id,
        availabilityInput({ dayOfWeek: 2, startsAt: "12:00", endsAt: "15:00" }),
        context
      )
    ).rejects.toThrow("Doctor availability overlaps an existing rule");
  });

  it("rejects availability outside clinic operating hours", async () => {
    const clinic = await createClinicWithLocation("outside-hours");
    await createClinicHour(clinic.locationId, 3, "09:00", "13:00");
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);

    await expect(
      availability.createClinicAvailabilityRule(
        superAdmin,
        clinic.clinicId,
        association.id,
        availabilityInput({ dayOfWeek: 3, startsAt: "08:00", endsAt: "10:00" }),
        context
      )
    ).rejects.toThrow("Availability must fall inside clinic operating hours");
  });

  it("rejects availability for unapproved associations and unapproved doctors", async () => {
    const clinic = await createClinicWithLocation("unapproved-availability");
    await createClinicHour(clinic.locationId, 4, "09:00", "17:00");
    const pendingAssociation = await createDoctorAssociation(
      clinic.clinicId,
      clinic.locationId,
      ClinicAssociationStatus.PENDING,
      DoctorStatus.APPROVED
    );
    const unapprovedDoctorAssociation = await createDoctorAssociation(
      clinic.clinicId,
      clinic.locationId,
      ClinicAssociationStatus.APPROVED,
      DoctorStatus.PENDING_APPROVAL
    );
    const unapprovedDoctor = asUser(unapprovedDoctorAssociation.doctorUserId, ["doctor"]);

    await expect(
      availability.createClinicAvailabilityRule(
        superAdmin,
        clinic.clinicId,
        pendingAssociation.id,
        availabilityInput({ dayOfWeek: 4, startsAt: "09:00", endsAt: "12:00" }),
        context
      )
    ).rejects.toThrow("Availability can only be managed for an approved doctor-clinic association");

    await expect(
      availability.createMyAvailabilityRule(
        unapprovedDoctor,
        unapprovedDoctorAssociation.id,
        availabilityInput({ dayOfWeek: 4, startsAt: "13:00", endsAt: "16:00" }),
        context
      )
    ).rejects.toThrow("Missing required permission");
  });

  it("rejects breaks outside the parent availability window", async () => {
    const clinic = await createClinicWithLocation("break-window");
    await createClinicHour(clinic.locationId, 5, "09:00", "17:00");
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);
    const rule = await availability.createClinicAvailabilityRule(
      superAdmin,
      clinic.clinicId,
      association.id,
      availabilityInput({ dayOfWeek: 5, startsAt: "09:00", endsAt: "13:00" }),
      context
    );

    await expect(
      availability.createClinicAvailabilityBreak(
        superAdmin,
        clinic.clinicId,
        rule.id,
        { startsAt: "08:30", endsAt: "09:30" },
        context
      )
    ).rejects.toThrow("Break must fall inside availability rule");

    await expect(
      availability.createClinicAvailabilityBreak(
        superAdmin,
        clinic.clinicId,
        rule.id,
        { startsAt: "10:00", endsAt: "10:15" },
        context
      )
    ).resolves.toEqual(expect.objectContaining({ ruleId: rule.id }));
  });

  it("rejects invalid and cross-association service-specific time off", async () => {
    const clinic = await createClinicWithLocation("time-off");
    const firstAssociation = await createApprovedAssociation(clinic.clinicId, clinic.locationId);
    const secondAssociation = await createApprovedAssociation(clinic.clinicId, clinic.locationId);
    const secondDoctorClinicServiceId = await createDoctorClinicService(
      clinic.clinicId,
      secondAssociation.id
    );

    await expect(
      availability.createClinicTimeOff(
        superAdmin,
        clinic.clinicId,
        firstAssociation.id,
        {
          startsAt: "2036-01-02T10:00:00+05:30",
          endsAt: "2036-01-02T10:00:00+05:30",
          reason: "Invalid"
        },
        context
      )
    ).rejects.toThrow("Time off end must be after start");

    await expect(
      availability.createClinicTimeOff(
        superAdmin,
        clinic.clinicId,
        firstAssociation.id,
        {
          startsAt: "2036-01-02T10:00:00+05:30",
          endsAt: "2036-01-02T11:00:00+05:30",
          doctorClinicServiceId: secondDoctorClinicServiceId,
          reason: "Wrong association"
        },
        context
      )
    ).rejects.toThrow("Doctor clinic service does not belong to this association");
  });

  it("returns clinic closures with availability so closures can override recurring rules", async () => {
    const clinic = await createClinicWithLocation("closure-override");
    await createClinicHour(clinic.locationId, 1, "09:00", "17:00");
    await prisma.clinicLocationClosure.create({
      data: {
        locationId: clinic.locationId,
        startsAt: new Date("2036-02-01T03:30:00.000Z"),
        endsAt: new Date("2036-02-01T11:30:00.000Z"),
        reason: "Public holiday"
      }
    });
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);

    await availability.createClinicAvailabilityRule(
      superAdmin,
      clinic.clinicId,
      association.id,
      availabilityInput({ dayOfWeek: 1, startsAt: "09:00", endsAt: "17:00" }),
      context
    );

    const listed = await availability.listClinicAvailability(
      superAdmin,
      clinic.clinicId,
      association.id
    );

    expect(listed.availabilityRules).toHaveLength(1);
    expect(listed.clinicClosures).toEqual([
      expect.objectContaining({ reason: "Public holiday" })
    ]);
  });

  it("prevents clinic admins from managing another clinic's doctor availability", async () => {
    const firstClinic = await createClinicWithLocation("admin-scope-first");
    const secondClinic = await createClinicWithLocation("admin-scope-second");
    await createClinicHour(secondClinic.locationId, 2, "09:00", "17:00");
    const firstClinicAdmin = asUser(
      await createClinicAdmin(firstClinic.clinicId, "availability-first-admin"),
      ["clinic_admin"]
    );
    const secondAssociation = await createApprovedAssociation(
      secondClinic.clinicId,
      secondClinic.locationId
    );

    await expect(
      availability.createClinicAvailabilityRule(
        firstClinicAdmin,
        secondClinic.clinicId,
        secondAssociation.id,
        availabilityInput({ dayOfWeek: 2, startsAt: "09:00", endsAt: "12:00" }),
        context
      )
    ).rejects.toThrow("Missing required permission");
  });

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Availability Test User",
        status: UserStatus.ACTIVE,
        roles: {
          create: { roleId: role.id }
        }
      },
      select: { id: true }
    });

    return user.id;
  }

  async function createClinicAdmin(clinicId: string, prefix: string) {
    const userId = await createUserWithRole(prefix, "clinic_admin");
    await prisma.clinicAdmin.create({
      data: {
        userId,
        clinicId,
        status: ClinicAssociationStatus.APPROVED
      }
    });

    return userId;
  }

  async function createClinicWithLocation(prefix: string) {
    const clinic = await prisma.clinic.create({
      data: {
        name: "Availability Test Clinic",
        slug: uniqueSlug(prefix),
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "456 Availability Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });

    return {
      clinicId: clinic.id,
      locationId: location.id
    };
  }

  async function createClinicHour(
    locationId: string,
    dayOfWeek: number,
    opensAt: string,
    closesAt: string
  ) {
    return prisma.clinicLocationHour.create({
      data: {
        locationId,
        dayOfWeek,
        opensAt: timeToDate(opensAt),
        closesAt: timeToDate(closesAt),
        isClosed: false
      }
    });
  }

  async function createApprovedAssociation(clinicId: string, clinicLocationId: string) {
    return createDoctorAssociation(
      clinicId,
      clinicLocationId,
      ClinicAssociationStatus.APPROVED,
      DoctorStatus.APPROVED
    );
  }

  async function createDoctorAssociation(
    clinicId: string,
    clinicLocationId: string,
    associationStatus: ClinicAssociationStatus,
    doctorStatus: DoctorStatus
  ) {
    const userId = await createUserWithRole(`availability-doctor-${doctorStatus}`, "doctor");
    const doctor = await prisma.doctor.create({
      data: {
        userId,
        slug: uniqueSlug(`availability-doctor-${doctorStatus}`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: doctorStatus
      },
      select: { id: true, userId: true }
    });
    const association = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId,
        clinicLocationId,
        status: associationStatus,
        currency: "LKR",
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      select: {
        id: true,
        doctorId: true,
        doctor: { select: { userId: true } }
      }
    });

    return {
      id: association.id,
      doctorId: association.doctorId,
      doctorUserId: association.doctor.userId
    };
  }

  async function createDoctorClinicService(clinicId: string, doctorClinicId: string) {
    const masterService = await prisma.service.create({
      data: {
        name: "Availability Consultation",
        slug: uniqueSlug("availability-service"),
        defaultDurationMinutes: 30
      },
      select: { id: true }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId,
        serviceId: masterService.id
      },
      select: { id: true }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR"
      },
      select: { id: true }
    });

    return doctorClinicService.id;
  }

  function availabilityInput(overrides: {
    dayOfWeek: number;
    startsAt: string;
    endsAt: string;
  }) {
    return {
      dayOfWeek: overrides.dayOfWeek,
      startsAt: overrides.startsAt,
      endsAt: overrides.endsAt,
      slotIntervalMinutes: 15,
      maxPatients: 1,
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true
    };
  }

  function timeToDate(value: string) {
    const normalized = value.length === 5 ? `${value}:00` : value;

    return new Date(`1970-01-01T${normalized}.000Z`);
  }
});
