import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  DoctorStatus,
  PaymentMode,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditModule } from "../src/audit/audit.module.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { ClinicModule } from "../src/clinics/clinic.module.js";
import {
  createClinicLocationSchema,
  createClinicSchema,
  createClosureSchema,
  setLocationHoursSchema,
  updateClinicLocationSchema
} from "../src/clinics/clinic.schemas.js";
import { ClinicService } from "../src/clinics/clinic.service.js";
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

function uniquePhone() {
  return `+94${Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0")}`;
}

function asUser(id: string, roles: string[]): AuthenticatedUser {
  return {
    id,
    roles,
    sessionId: "clinic-test-session"
  };
}

describeDatabase("clinic management integration", () => {
  let moduleRef: TestingModule;
  let clinics: ClinicService;
  let prisma: PrismaService;
  let superAdmin: AuthenticatedUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuditModule, AuthorizationModule, ClinicModule]
    }).compile();
    await moduleRef.init();

    clinics = moduleRef.get(ClinicService);
    prisma = moduleRef.get(PrismaService);
    superAdmin = asUser(await createUserWithRole("clinic-super-admin", "super_admin"), [
      "super_admin"
    ]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("keeps a single primary location per clinic and writes audit logs", async () => {
    const clinic = await createClinic("primary-location");
    const firstLocation = await clinics.createLocation(
      superAdmin,
      clinic.id,
      locationInput("10 First Street", true),
      context
    );
    const secondLocation = await clinics.createLocation(
      superAdmin,
      clinic.id,
      locationInput("20 Second Street", true),
      context
    );

    const locations = await prisma.clinicLocation.findMany({
      where: { clinicId: clinic.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }]
    });
    const primaryLocationIds = locations
      .filter((location) => location.isPrimary)
      .map((location) => location.id);
    const auditCount = await prisma.auditLog.count({
      where: {
        clinicId: clinic.id,
        actionCode: { in: ["clinic.create", "clinic.location.create"] }
      }
    });

    expect(firstLocation.isPrimary).toBe(true);
    expect(secondLocation.isPrimary).toBe(true);
    expect(primaryLocationIds).toEqual([secondLocation.id]);
    expect(auditCount).toBeGreaterThanOrEqual(3);
  });

  it("returns clear conflicts for duplicate clinic slug, email, and phone", async () => {
    const slug = uniqueSlug("duplicate-clinic");
    const email = uniqueEmail("duplicate-clinic");
    const phone = uniquePhone();

    await clinics.createClinic(
      superAdmin,
      createClinicSchema.parse({
        name: "Duplicate Clinic",
        slug,
        email,
        phone,
        defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
        cancellationWindowMinutes: 30,
        refundProcessingDays: 7
      }),
      context
    );

    await expect(
      clinics.createClinic(
        superAdmin,
        createClinicSchema.parse({
          name: "Duplicate Clinic Name Allowed",
          slug,
          email: uniqueEmail("duplicate-clinic-other"),
          phone: uniquePhone(),
          defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
          cancellationWindowMinutes: 30,
          refundProcessingDays: 7
        }),
        context
      )
    ).rejects.toThrow("Clinic slug already exists. Use a different slug.");

    await expect(
      clinics.createClinic(
        superAdmin,
        createClinicSchema.parse({
          name: "Duplicate Clinic Email",
          slug: uniqueSlug("duplicate-clinic-email"),
          email,
          phone: uniquePhone(),
          defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
          cancellationWindowMinutes: 30,
          refundProcessingDays: 7
        }),
        context
      )
    ).rejects.toThrow("Clinic email already exists. Use a different email address.");

    await expect(
      clinics.createClinic(
        superAdmin,
        createClinicSchema.parse({
          name: "Duplicate Clinic Phone",
          slug: uniqueSlug("duplicate-clinic-phone"),
          email: uniqueEmail("duplicate-clinic-phone"),
          phone,
          defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
          cancellationWindowMinutes: 30,
          refundProcessingDays: 7
        }),
        context
      )
    ).rejects.toThrow("Clinic phone number already exists. Use a different phone number.");
  });

  it("accepts split operating hours and rejects overlapping or invalid ranges", async () => {
    const clinic = await createClinic("hours");
    const location = await createLocation(clinic.id);

    await expect(
      clinics.setLocationHours(
        superAdmin,
        clinic.id,
        location.id,
        setLocationHoursSchema.parse({
          hours: [
            { dayOfWeek: 1, opensAt: "09:00", closesAt: "12:00" },
            { dayOfWeek: 1, opensAt: "13:00", closesAt: "17:00" }
          ]
        }),
        context
      )
    ).resolves.toEqual(
      expect.objectContaining({
        hours: expect.arrayContaining([
          expect.objectContaining({ dayOfWeek: 1 }),
          expect.objectContaining({ dayOfWeek: 1 })
        ])
      })
    );

    await expect(
      clinics.setLocationHours(
        superAdmin,
        clinic.id,
        location.id,
        setLocationHoursSchema.parse({
          hours: [
            { dayOfWeek: 2, opensAt: "09:00", closesAt: "14:00" },
            { dayOfWeek: 2, opensAt: "13:00", closesAt: "18:00" }
          ]
        }),
        context
      )
    ).rejects.toThrow();

    await expect(
      clinics.setLocationHours(
        superAdmin,
        clinic.id,
        location.id,
        setLocationHoursSchema.parse({
          hours: [
            {
              dayOfWeek: 3,
              opensAt: "09:00",
              closesAt: "12:00",
              effectiveFrom: "2035-02-02",
              effectiveTo: "2035-02-01"
            }
          ]
        }),
        context
      )
    ).rejects.toThrow();
  });

  it("rejects closures where the end time is before the start time", async () => {
    const clinic = await createClinic("closure");
    const location = await createLocation(clinic.id);

    await expect(
      clinics.createClosure(
        superAdmin,
        clinic.id,
        location.id,
        createClosureSchema.parse({
          startsAt: "2035-03-01T10:00:00.000Z",
          endsAt: "2035-03-01T09:00:00.000Z",
          reason: "Maintenance"
        }),
        context
      )
    ).rejects.toThrow();
  });

  it("enforces location ownership and excludes soft-deleted locations from normal queries", async () => {
    const clinic = await createClinic("location-owner");
    const otherClinic = await createClinic("location-owner-other");
    const location = await createLocation(clinic.id);

    await expect(
      clinics.updateLocation(
        superAdmin,
        otherClinic.id,
        location.id,
        updateClinicLocationSchema.parse({ city: "Kandy" }),
        context
      )
    ).rejects.toThrow("Clinic location not found");

    await clinics.deleteLocation(superAdmin, clinic.id, location.id, context);

    await expect(clinics.listLocations(superAdmin, clinic.id)).resolves.toEqual({
      locations: []
    });
  });

  it("allows assigned clinic admins only inside their clinic", async () => {
    const clinic = await createClinic("assigned-admin");
    const otherClinic = await createClinic("assigned-admin-other");
    const adminUserId = await createBareUser("assigned-clinic-admin");

    await clinics.assignClinicAdmin(superAdmin, clinic.id, { userId: adminUserId }, context);
    const clinicAdmin = asUser(adminUserId, ["clinic_admin"]);

    await expect(clinics.getClinic(clinicAdmin, clinic.id)).resolves.toEqual(
      expect.objectContaining({ id: clinic.id })
    );
    await expect(clinics.getClinic(clinicAdmin, otherClinic.id)).rejects.toThrow(
      "Missing required permission"
    );
  });

  it("refuses to delete clinics that have future appointments", async () => {
    const clinic = await createClinic("future-appointment");
    const location = await createLocation(clinic.id);

    await createFutureAppointment(clinic.id, location.id);

    await expect(clinics.deleteClinic(superAdmin, clinic.id, context)).rejects.toThrow(
      "Cannot delete record with future appointments"
    );
  });

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Clinic Test User",
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

  async function createBareUser(prefix: string) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Clinic Admin Candidate",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });

    return user.id;
  }

  async function createClinic(prefix: string) {
    const clinic = await clinics.createClinic(
      superAdmin,
      createClinicSchema.parse({
        name: "Clinic Integration Test",
        slug: uniqueSlug(prefix),
        email: uniqueEmail(prefix),
        phone: uniquePhone(),
        defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
        cancellationWindowMinutes: 30,
        refundProcessingDays: 7
      }),
      context
    );

    return clinic;
  }

  async function createLocation(clinicId: string) {
    return clinics.createLocation(
      superAdmin,
      clinicId,
      locationInput("123 Clinic Street"),
      context
    );
  }

  function locationInput(address: string, isPrimary = false) {
    return createClinicLocationSchema.parse({
      name: "Main Branch",
      address,
      city: "Colombo",
      district: "Colombo",
      province: "Western",
      phone: "+94771111111",
      isPrimary
    });
  }

  async function createFutureAppointment(clinicId: string, locationId: string) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail("future-patient"),
        fullName: "Future Patient",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });
    const patient = await prisma.patient.create({
      data: { userId: patientUser.id },
      select: { id: true }
    });
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail("future-doctor"),
        fullName: "Future Doctor",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug("future-doctor"),
        status: DoctorStatus.APPROVED
      },
      select: { id: true }
    });
    const service = await prisma.service.create({
      data: {
        name: "Future Appointment Consultation",
        slug: uniqueSlug("future-service"),
        defaultDurationMinutes: 30
      },
      select: { id: true }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId,
        serviceId: service.id
      },
      select: { id: true }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId,
        clinicLocationId: locationId,
        status: ClinicAssociationStatus.APPROVED,
        approvedByUserId: superAdmin.id,
        approvedAt: new Date()
      },
      select: { id: true }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR"
      },
      select: { id: true }
    });
    const startsAt = new Date("2036-01-01T04:00:00.000Z");
    const endsAt = new Date("2036-01-01T04:30:00.000Z");

    await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId,
        clinicLocationId: locationId,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt,
        endsAt,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Future Appointment Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Future Patient"
      }
    });
  }
});
