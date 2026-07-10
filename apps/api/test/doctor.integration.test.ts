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
import { AuthModule } from "../src/auth/auth.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AuthenticatedUser, RequestContext } from "../src/auth/auth.types.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { AuthorizationService } from "../src/authorization/authorization.service.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { DoctorModule } from "../src/doctors/doctor.module.js";
import { DoctorService } from "../src/doctors/doctor.service.js";

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
    sessionId: "doctor-test-session"
  };
}

describeDatabase("doctor onboarding integration", () => {
  let moduleRef: TestingModule;
  let auth: AuthService;
  let authorization: AuthorizationService;
  let doctors: DoctorService;
  let prisma: PrismaService;
  let superAdmin: AuthenticatedUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, AuthorizationModule, DoctorModule]
    }).compile();
    await moduleRef.init();

    auth = moduleRef.get(AuthService);
    authorization = moduleRef.get(AuthorizationService);
    doctors = moduleRef.get(DoctorService);
    prisma = moduleRef.get(PrismaService);
    superAdmin = asUser(await createUserWithRole("doctor-super-admin", "super_admin"), [
      "super_admin"
    ]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("registers a doctor atomically, assigns the doctor role, and allows login after email verification", async () => {
    const specialtyId = await getSpecialtyId();
    const password = "Password123!";
    const registration = await registerDoctor("registration", {
      password,
      specialtyIds: [specialtyId]
    });

    expect(registration.verificationToken).toEqual(expect.any(String));
    expect(registration.doctor.status).toBe(DoctorStatus.PENDING_APPROVAL);

    const storedDoctor = await prisma.doctor.findUniqueOrThrow({
      where: { id: registration.doctor.id },
      include: {
        user: {
          include: {
            roles: {
              include: { role: true }
            }
          }
        },
        specialties: true
      }
    });

    expect(storedDoctor.user.roles.map((role) => role.role.code)).toContain("doctor");
    expect(storedDoctor.specialties).toHaveLength(1);

    await auth.verifyEmail({ token: registration.verificationToken as string }, context);
    const login = await auth.login(
      {
        email: registration.user.email as string,
        password
      },
      context
    );

    expect(login.user.status).toBe(UserStatus.ACTIVE);
    expect(login.user.roles).toContain("doctor");
  });

  it("rejects duplicate doctor license numbers", async () => {
    const licenseNumber = `SLMC-${randomUUID()}`;

    await registerDoctor("license-first", { licenseNumber });

    await expect(registerDoctor("license-second", { licenseNumber })).rejects.toThrow(
      "Doctor license number is already registered"
    );
  });

  it("blocks unapproved doctors from protected availability workflows", async () => {
    const registration = await registerVerifiedDoctor("pending-availability");
    const clinic = await createClinicWithLocation("pending-availability");
    const doctorActor = asUser(registration.user.id, ["doctor"]);
    const association = await doctors.requestClinicAssociation(
      doctorActor,
      {
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        currency: "LKR",
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      context
    );

    await expect(
      authorization.can(doctorActor, "availability.manage", {
        scope: "doctor_clinic",
        scopeId: association.id
      })
    ).resolves.toBe(false);
  });

  it("allows only Super Admin to approve identity and requires rejection reasons", async () => {
    const registration = await registerVerifiedDoctor("identity-review");
    const clinic = await createClinicWithLocation("identity-review");
    const clinicAdmin = await createClinicAdmin(clinic.clinicId);

    await expect(
      doctors.approveDoctor(
        asUser(clinicAdmin.userId, ["clinic_admin"]),
        registration.doctor.id,
        context
      )
    ).rejects.toThrow("Missing required permission");

    await expect(
      doctors.rejectDoctor(superAdmin, registration.doctor.id, { reason: "" }, context)
    ).rejects.toThrow();

    const approved = await doctors.approveDoctor(superAdmin, registration.doctor.id, context);

    expect(approved.status).toBe(DoctorStatus.APPROVED);
    expect(approved.approvedByUserId).toBe(superAdmin.id);
  });

  it("prevents doctors from modifying another doctor profile", async () => {
    const first = await registerVerifiedDoctor("profile-owner-first");
    const second = await registerVerifiedDoctor("profile-owner-second");
    const secondActor = asUser(second.user.id, ["doctor"]);

    await expect(
      authorization.can(secondActor, "doctor.profile.update", {
        scope: "doctor",
        scopeId: first.doctor.id
      })
    ).resolves.toBe(false);
  });

  it("keeps platform verification separate from clinic association approval", async () => {
    const registration = await registerVerifiedDoctor("association");
    const clinic = await createClinicWithLocation("association");
    const otherClinic = await createClinicWithLocation("association-other");
    const clinicAdmin = await createClinicAdmin(clinic.clinicId);
    const otherClinicAdmin = await createClinicAdmin(otherClinic.clinicId);
    const doctorActor = asUser(registration.user.id, ["doctor"]);

    await expect(
      doctors.requestClinicAssociation(
        doctorActor,
        {
          clinicId: clinic.clinicId,
          clinicLocationId: otherClinic.locationId,
          currency: "LKR",
          defaultSlotIntervalMinutes: 15,
          bufferMinutes: 0
        },
        context
      )
    ).rejects.toThrow("Clinic location does not belong to clinic");

    const association = await doctors.requestClinicAssociation(
      doctorActor,
      {
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        defaultConsultationFeeMinor: 250000,
        currency: "LKR",
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      context
    );

    await expect(
      doctors.approveClinicAssociation(
        asUser(clinicAdmin.userId, ["clinic_admin"]),
        clinic.clinicId,
        association.id,
        context
      )
    ).rejects.toThrow("Doctor identity must be approved first");

    await doctors.approveDoctor(superAdmin, registration.doctor.id, context);

    await expect(
      doctors.approveClinicAssociation(
        asUser(otherClinicAdmin.userId, ["clinic_admin"]),
        clinic.clinicId,
        association.id,
        context
      )
    ).rejects.toThrow("Missing required permission");

    const approvedAssociation = await doctors.approveClinicAssociation(
      asUser(clinicAdmin.userId, ["clinic_admin"]),
      clinic.clinicId,
      association.id,
      context
    );

    expect(approvedAssociation.status).toBe(ClinicAssociationStatus.APPROVED);

    const refreshedDoctor = await prisma.doctor.findUniqueOrThrow({
      where: { id: registration.doctor.id },
      select: { status: true }
    });

    expect(refreshedDoctor.status).toBe(DoctorStatus.APPROVED);
  });

  it("validates document ownership for clinic-scoped document reviews", async () => {
    const registration = await registerVerifiedDoctor("document-owner");
    const otherRegistration = await registerVerifiedDoctor("document-owner-other");
    const clinic = await createClinicWithLocation("document-owner");
    const clinicAdmin = await createClinicAdmin(clinic.clinicId);
    const actor = asUser(registration.user.id, ["doctor"]);
    const otherActor = asUser(otherRegistration.user.id, ["doctor"]);

    await doctors.approveDoctor(superAdmin, registration.doctor.id, context);

    const association = await doctors.requestClinicAssociation(
      actor,
      {
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        currency: "LKR",
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      context
    );
    await doctors.approveClinicAssociation(
      asUser(clinicAdmin.userId, ["clinic_admin"]),
      clinic.clinicId,
      association.id,
      context
    );

    const document = await doctors.createMyDocument(actor, documentInput("license"), context);
    const otherDocument = await doctors.createMyDocument(
      otherActor,
      documentInput("other-license"),
      context
    );

    await expect(
      doctors.reviewClinicDocument(
        asUser(clinicAdmin.userId, ["clinic_admin"]),
        clinic.clinicId,
        association.id,
        otherDocument.id,
        { status: "APPROVED" },
        context
      )
    ).rejects.toThrow("Doctor document not found for this association");

    await expect(
      doctors.reviewClinicDocument(
        asUser(clinicAdmin.userId, ["clinic_admin"]),
        clinic.clinicId,
        association.id,
        document.id,
        { status: "APPROVED" },
        context
      )
    ).resolves.toEqual(expect.objectContaining({ status: "APPROVED" }));
  });

  it("blocks removal of an approved association with future appointments", async () => {
    const registration = await registerVerifiedDoctor("future-association");
    const clinic = await createClinicWithLocation("future-association");
    const clinicAdmin = await createClinicAdmin(clinic.clinicId);
    const actor = asUser(registration.user.id, ["doctor"]);

    await doctors.approveDoctor(superAdmin, registration.doctor.id, context);
    const association = await doctors.requestClinicAssociation(
      actor,
      {
        clinicId: clinic.clinicId,
        clinicLocationId: clinic.locationId,
        currency: "LKR",
        defaultSlotIntervalMinutes: 15,
        bufferMinutes: 0
      },
      context
    );
    await doctors.approveClinicAssociation(
      asUser(clinicAdmin.userId, ["clinic_admin"]),
      clinic.clinicId,
      association.id,
      context
    );
    await createFutureAppointment(
      registration.doctor.id,
      clinic.clinicId,
      clinic.locationId,
      association.id
    );

    await expect(doctors.removeMyAssociation(actor, association.id, context)).rejects.toThrow(
      "Cannot remove association with future appointments"
    );
  });

  async function registerDoctor(
    prefix: string,
    overrides: {
      password?: string;
      licenseNumber?: string;
      specialtyIds?: string[];
    } = {}
  ) {
    return doctors.registerDoctor(
      {
        email: uniqueEmail(prefix),
        fullName: "Doctor Integration Test",
        password: overrides.password ?? "Password123!",
        licenseNumber: overrides.licenseNumber ?? `SLMC-${randomUUID()}`,
        qualifications: "MBBS",
        bio: "General practitioner",
        yearsExperience: 8,
        languages: ["English"],
        specialtyIds: overrides.specialtyIds ?? []
      },
      context
    );
  }

  async function registerVerifiedDoctor(prefix: string) {
    const registration = await registerDoctor(prefix);
    await auth.verifyEmail({ token: registration.verificationToken as string }, context);

    return registration;
  }

  async function createUserWithRole(prefix: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true }
    });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        fullName: "Doctor Test User",
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

  async function createClinicAdmin(clinicId: string) {
    const userId = await createUserWithRole("doctor-clinic-admin", "clinic_admin");
    const admin = await prisma.clinicAdmin.create({
      data: {
        userId,
        clinicId,
        status: ClinicAssociationStatus.APPROVED
      },
      select: { id: true, userId: true }
    });

    return admin;
  }

  async function createClinicWithLocation(prefix: string) {
    const clinic = await prisma.clinic.create({
      data: {
        name: "Doctor Test Clinic",
        slug: uniqueSlug(prefix),
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });
    const location = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "123 Doctor Street",
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

  async function getSpecialtyId() {
    const specialty = await prisma.specialty.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true }
    });

    return specialty.id;
  }

  function documentInput(prefix: string) {
    return {
      documentType: "medical_license",
      storageProvider: "local",
      objectKey: `doctor-documents/${prefix}-${randomUUID()}.pdf`,
      originalFilename: `${prefix}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 2048
    };
  }

  async function createFutureAppointment(
    doctorId: string,
    clinicId: string,
    clinicLocationId: string,
    doctorClinicId: string
  ) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail("doctor-future-patient"),
        fullName: "Future Patient",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });
    const patient = await prisma.patient.create({
      data: { userId: patientUser.id },
      select: { id: true }
    });
    const service = await prisma.service.create({
      data: {
        name: "Doctor Future Consultation",
        slug: uniqueSlug("doctor-future-service"),
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

    await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId,
        clinicId,
        clinicLocationId,
        doctorClinicId,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt: new Date("2036-02-01T04:00:00.000Z"),
        endsAt: new Date("2036-02-01T04:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Doctor Future Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Future Patient"
      }
    });
  }
});
