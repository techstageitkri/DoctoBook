import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditModule } from "../src/audit/audit.module.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AppointmentServiceConfigService } from "../src/services/service.service.js";
import { ServiceConfigModule } from "../src/services/service.module.js";

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
    sessionId: "service-test-session"
  };
}

describeDatabase("service configuration integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let serviceConfig: AppointmentServiceConfigService;
  let superAdmin: AuthenticatedUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuditModule, AuthorizationModule, ServiceConfigModule]
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    serviceConfig = moduleRef.get(AppointmentServiceConfigService);
    superAdmin = asUser(await createUserWithRole("service-super-admin", "super_admin"), [
      "super_admin"
    ]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("rejects duplicate clinic services for the same master service", async () => {
    const clinic = await createClinicWithLocation("duplicate-clinic-service");
    const masterService = await createMasterService("duplicate-clinic-service");

    await serviceConfig.createClinicService(
      superAdmin,
      clinic.clinicId,
      { serviceId: masterService.id, isActive: true },
      context
    );

    await expect(
      serviceConfig.createClinicService(
        superAdmin,
        clinic.clinicId,
        { serviceId: masterService.id, isActive: true },
        context
      )
    ).rejects.toThrow("Service is already enabled for this clinic");
  });

  it("rejects doctor service configuration for cross-clinic or inactive clinic services", async () => {
    const firstClinic = await createClinicWithLocation("cross-clinic-first");
    const secondClinic = await createClinicWithLocation("cross-clinic-second");
    const association = await createApprovedAssociation(firstClinic.clinicId, firstClinic.locationId);
    const firstClinicService = await createClinicService(firstClinic.clinicId, "cross-clinic-one");
    const secondClinicService = await createClinicService(secondClinic.clinicId, "cross-clinic-two");
    const inactiveClinicService = await createClinicService(
      firstClinic.clinicId,
      "inactive-clinic-service",
      false
    );

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        firstClinic.clinicId,
        association.id,
        doctorServiceInput(secondClinicService.id),
        context
      )
    ).rejects.toThrow("Clinic service not found");

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        firstClinic.clinicId,
        association.id,
        doctorServiceInput(inactiveClinicService.id),
        context
      )
    ).rejects.toThrow("Inactive clinic service cannot be assigned to a doctor");

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        firstClinic.clinicId,
        association.id,
        doctorServiceInput(firstClinicService.id, { feeMinor: 0 }),
        context
      )
    ).resolves.toEqual(expect.objectContaining({ feeMinor: "0" }));
  });

  it("rejects doctor service configuration for unapproved associations and invalid values", async () => {
    const clinic = await createClinicWithLocation("invalid-doctor-service");
    const pendingAssociation = await createDoctorAssociation(
      clinic.clinicId,
      clinic.locationId,
      ClinicAssociationStatus.PENDING
    );
    const approvedAssociation = await createDoctorAssociation(
      clinic.clinicId,
      clinic.locationId,
      ClinicAssociationStatus.APPROVED
    );
    const clinicService = await createClinicService(clinic.clinicId, "invalid-doctor-service");

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        clinic.clinicId,
        pendingAssociation.id,
        doctorServiceInput(clinicService.id),
        context
      )
    ).rejects.toThrow("Doctor service can only be configured for an approved clinic association");

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        clinic.clinicId,
        approvedAssociation.id,
        doctorServiceInput(clinicService.id, { durationMinutes: 0 }),
        context
      )
    ).rejects.toThrow("Duration must be greater than zero");

    await expect(
      serviceConfig.createClinicDoctorService(
        superAdmin,
        clinic.clinicId,
        approvedAssociation.id,
        doctorServiceInput(clinicService.id, { feeMinor: -1 }),
        context
      )
    ).rejects.toThrow("Fee cannot be negative");
  });

  it("resolves payment mode inheritance from doctor service to doctor-clinic and clinic", async () => {
    const clinic = await createClinicWithLocation("payment-inheritance", PaymentMode.PAY_AT_CLINIC);
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId, {
      paymentMode: null
    });
    const clinicService = await createClinicService(clinic.clinicId, "payment-inheritance");

    const inherited = await serviceConfig.createClinicDoctorService(
      superAdmin,
      clinic.clinicId,
      association.id,
      doctorServiceInput(clinicService.id, { paymentMode: null }),
      context
    );

    expect(inherited.effectivePaymentMode).toBe(PaymentMode.PAY_AT_CLINIC);

    const explicit = await serviceConfig.updateClinicDoctorService(
      superAdmin,
      clinic.clinicId,
      inherited.id,
      { paymentMode: PaymentMode.ONLINE_REQUIRED },
      context
    );

    expect(explicit.effectivePaymentMode).toBe(PaymentMode.ONLINE_REQUIRED);
  });

  it("enforces clinic and doctor ownership rules", async () => {
    const firstClinic = await createClinicWithLocation("ownership-first");
    const secondClinic = await createClinicWithLocation("ownership-second");
    const firstClinicAdmin = asUser(
      await createClinicAdmin(firstClinic.clinicId, "ownership-first-admin"),
      ["clinic_admin"]
    );
    const secondAssociation = await createApprovedAssociation(
      secondClinic.clinicId,
      secondClinic.locationId
    );
    const secondClinicService = await createClinicService(secondClinic.clinicId, "ownership-second");
    const otherDoctor = await createDoctor("ownership-other-doctor");

    await expect(
      serviceConfig.createClinicService(
        firstClinicAdmin,
        secondClinic.clinicId,
        { serviceId: secondClinicService.serviceId, isActive: true },
        context
      )
    ).rejects.toThrow("Missing required permission");

    await expect(
      serviceConfig.createMyDoctorClinicService(
        asUser(otherDoctor.userId, ["doctor"]),
        secondAssociation.id,
        doctorServiceInput(secondClinicService.id),
        context
      )
    ).rejects.toThrow("Missing required permission");
  });

  it("does not alter existing appointment fee snapshots when service pricing changes", async () => {
    const clinic = await createClinicWithLocation("snapshot-pricing");
    const association = await createApprovedAssociation(clinic.clinicId, clinic.locationId);
    const clinicService = await createClinicService(clinic.clinicId, "snapshot-pricing");
    const doctorClinicService = await serviceConfig.createClinicDoctorService(
      superAdmin,
      clinic.clinicId,
      association.id,
      doctorServiceInput(clinicService.id, { feeMinor: 123000 }),
      context
    );
    const appointment = await createAppointmentSnapshot(
      clinic,
      association,
      doctorClinicService.id,
      123000n
    );

    await serviceConfig.updateClinicDoctorService(
      superAdmin,
      clinic.clinicId,
      doctorClinicService.id,
      { feeMinor: 456000 },
      context
    );

    const unchanged = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { feeMinor: true }
    });

    expect(unchanged.feeMinor).toBe(123000n);
  });

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Service Test User",
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

  async function createDoctor(prefix: string) {
    const userId = await createUserWithRole(prefix, "doctor");
    const doctor = await prisma.doctor.create({
      data: {
        userId,
        slug: uniqueSlug(prefix),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      },
      select: { id: true, userId: true }
    });

    return doctor;
  }

  async function createClinicWithLocation(prefix: string, defaultPaymentMode?: PaymentMode | null) {
    const clinic = await prisma.clinic.create({
      data: {
        name: "Service Test Clinic",
        slug: uniqueSlug(prefix),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode
      },
      select: { id: true }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "321 Service Street",
        city: "Colombo",
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });

    return {
      clinicId: clinic.id,
      locationId: location.id
    };
  }

  async function createMasterService(prefix: string) {
    return prisma.service.create({
      data: {
        name: "Service Test Consultation",
        slug: uniqueSlug(prefix),
        defaultDurationMinutes: 30,
        isActive: true
      },
      select: { id: true }
    });
  }

  async function createClinicService(clinicId: string, prefix: string, isActive = true) {
    const masterService = await createMasterService(prefix);

    return prisma.clinicService.create({
      data: {
        clinicId,
        serviceId: masterService.id,
        isActive
      },
      select: {
        id: true,
        serviceId: true
      }
    });
  }

  async function createApprovedAssociation(
    clinicId: string,
    clinicLocationId: string,
    overrides: { paymentMode?: PaymentMode | null } = {}
  ) {
    return createDoctorAssociation(clinicId, clinicLocationId, ClinicAssociationStatus.APPROVED, overrides);
  }

  async function createDoctorAssociation(
    clinicId: string,
    clinicLocationId: string,
    status: ClinicAssociationStatus,
    overrides: { paymentMode?: PaymentMode | null } = {}
  ) {
    const doctor = await createDoctor(`association-${status.toLowerCase()}`);

    return prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId,
        clinicLocationId,
        status,
        currency: "LKR",
        paymentMode: overrides.paymentMode,
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      select: {
        id: true,
        doctorId: true,
        clinicId: true,
        clinicLocationId: true
      }
    });
  }

  function doctorServiceInput(
    clinicServiceId: string,
    overrides: {
      durationMinutes?: number;
      feeMinor?: number | null;
      paymentMode?: PaymentMode | null;
    } = {}
  ) {
    return {
      clinicServiceId,
      durationMinutes: overrides.durationMinutes ?? 30,
      feeMinor: overrides.feeMinor ?? 250000,
      currency: "LKR",
      paymentMode: overrides.paymentMode ?? null,
      cancellationWindowMinutes: 30,
      rescheduleWindowMinutes: 30,
      maxReschedules: 2,
      isActive: true
    };
  }

  async function createAppointmentSnapshot(
    clinic: { clinicId: string; locationId: string },
    association: { id: string; doctorId: string },
    doctorClinicServiceId: string,
    feeMinor: bigint
  ) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail("snapshot-patient"),
        fullName: "Snapshot Patient",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });
    const patient = await prisma.patient.create({
      data: { userId: patientUser.id },
      select: { id: true }
    });

    return prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: association.doctorId,
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        doctorClinicId: association.id,
        doctorClinicServiceId,
        startsAt: new Date("2036-05-01T04:00:00.000Z"),
        endsAt: new Date("2036-05-01T04:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Snapshot Consultation",
        serviceDurationMinutes: 30,
        feeMinor,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Snapshot Patient"
      },
      select: { id: true }
    });
  }
});
