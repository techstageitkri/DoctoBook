import { randomUUID } from "node:crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  SlotHoldStatus,
  UserStatus
} from "@doctobook/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service.js";
import { PublicMarketplaceService } from "../src/public/public-marketplace.service.js";

process.env.NODE_ENV ??= "test";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const testDate = "2036-01-07";

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describeDatabase("public marketplace integration", () => {
  let prisma: PrismaService;
  let marketplace: PublicMarketplaceService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    marketplace = new PublicMarketplaceService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("lists only active public specialties and services", async () => {
    const activeSpecialty = await prisma.specialty.create({
      data: {
        name: "Public Active Specialty",
        slug: uniqueSlug("public-active-specialty"),
        isActive: true
      }
    });
    const inactiveSpecialty = await prisma.specialty.create({
      data: {
        name: "Public Inactive Specialty",
        slug: uniqueSlug("public-inactive-specialty"),
        isActive: false
      }
    });
    const activeService = await prisma.service.create({
      data: {
        name: "Public Active Service",
        slug: uniqueSlug("public-active-service"),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });
    const inactiveService = await prisma.service.create({
      data: {
        name: "Public Inactive Service",
        slug: uniqueSlug("public-inactive-service"),
        defaultDurationMinutes: 30,
        isActive: false
      }
    });

    const specialties = await marketplace.listSpecialties();
    const services = await marketplace.listServices();

    expect(specialties.specialties.map((specialty) => specialty.id)).toContain(activeSpecialty.id);
    expect(specialties.specialties.map((specialty) => specialty.id)).not.toContain(
      inactiveSpecialty.id
    );
    expect(services.services.map((service) => service.id)).toContain(activeService.id);
    expect(services.services.map((service) => service.id)).not.toContain(inactiveService.id);
  });

  it("exposes active clinics and approved doctors while hiding inactive records", async () => {
    const fixture = await createPublicFixture("public-search");
    const hiddenClinic = await prisma.clinic.create({
      data: {
        name: "Hidden Public Clinic",
        slug: uniqueSlug("hidden-public-clinic"),
        status: ClinicStatus.SUSPENDED
      }
    });
    const hiddenDoctor = await createDoctor("Hidden Public Doctor", DoctorStatus.PENDING_APPROVAL);

    const clinics = await marketplace.listClinics({
      specialtyId: fixture.specialtyId,
      limit: 50
    });
    const doctors = await marketplace.listDoctors({
      search: "Visible Public Doctor",
      specialtyId: fixture.specialtyId,
      clinicId: fixture.clinicId,
      serviceId: fixture.serviceId,
      minFeeMinor: 300000,
      maxFeeMinor: 400000,
      language: "en",
      minRating: 4,
      limit: 50
    });

    expect(clinics.clinics.map((clinic) => clinic.id)).toContain(fixture.clinicId);
    expect(await marketplace.getClinic(fixture.clinicSlug)).toEqual(
      expect.objectContaining({ id: fixture.clinicId, activeDoctorCount: 1 })
    );
    expect(await marketplace.getClinic(hiddenClinic.slug)).toBeNull();
    expect(doctors.doctors.map((doctor) => doctor.id)).toContain(fixture.doctorId);
    expect(await marketplace.getDoctor(fixture.doctorSlug)).toEqual(
      expect.objectContaining({ id: fixture.doctorId, fullName: "Visible Public Doctor" })
    );
    expect(await marketplace.getDoctor(hiddenDoctor.slug)).toBeNull();
  });

  it("returns doctor clinics and services with public fee and payment fallbacks", async () => {
    const fixture = await createPublicFixture("public-services");

    const doctorClinics = await marketplace.listDoctorClinics(fixture.doctorId);
    const doctorServices = await marketplace.listDoctorServices(fixture.doctorId);

    expect(doctorClinics.doctorClinics).toEqual([
      expect.objectContaining({
        doctorClinicId: fixture.doctorClinicId,
        clinicId: fixture.clinicId,
        clinicLocationId: fixture.clinicLocationId
      })
    ]);
    expect(doctorServices.doctorServices).toEqual([
      expect.objectContaining({
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceId,
        feeMinor: "345000",
        currency: "LKR",
        paymentMode: "pay_at_clinic"
      })
    ]);
  });

  it("returns active future slots without blocking appointments or active unexpired holds", async () => {
    const fixture = await createPublicFixture("public-availability");
    const availableSlot = await createSlot(fixture, "09:00");
    const bookedSlot = await createSlot(fixture, "09:30");
    const heldSlot = await createSlot(fixture, "10:00");
    const expiredHoldSlot = await createSlot(fixture, "10:30");

    await createAppointmentForSlot(fixture, bookedSlot, AppointmentStatus.CONFIRMED);
    const heldAppointment = await createAppointmentForSlot(
      fixture,
      heldSlot,
      AppointmentStatus.EXPIRED
    );
    await prisma.appointmentSlotHold.create({
      data: {
        slotId: heldSlot.id,
        userId: heldAppointment.userId,
        appointmentId: heldAppointment.id,
        idempotencyKey: `hold-${randomUUID()}`,
        status: SlotHoldStatus.ACTIVE,
        expiresAt: new Date("2036-01-07T05:30:00.000Z")
      }
    });
    const expiredHoldAppointment = await createAppointmentForSlot(
      fixture,
      expiredHoldSlot,
      AppointmentStatus.EXPIRED
    );
    await prisma.appointmentSlotHold.create({
      data: {
        slotId: expiredHoldSlot.id,
        userId: expiredHoldAppointment.userId,
        appointmentId: expiredHoldAppointment.id,
        idempotencyKey: `expired-hold-${randomUUID()}`,
        status: SlotHoldStatus.ACTIVE,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 60 * 1000)
      }
    });

    const availability = await marketplace.listAvailability({
      doctorId: fixture.doctorId,
      clinicId: fixture.clinicId,
      clinicLocationId: fixture.clinicLocationId,
      specialtyId: fixture.specialtyId,
      serviceId: fixture.serviceId,
      fromDate: testDate,
      toDate: testDate,
      limit: 50
    });

    expect(availability.availability.map((slot) => slot.slotId)).toEqual([
      availableSlot.id,
      expiredHoldSlot.id
    ]);
    expect(availability.availability[0]).toEqual(
      expect.objectContaining({
        startsAt: colomboUtc(testDate, "09:00").toISOString(),
        clinicTimezone: "Asia/Colombo",
        serviceName: "Public Consultation",
        durationMinutes: 30,
        feeMinor: "345000",
        currency: "LKR",
        paymentMode: "pay_at_clinic"
      })
    );
  });

  it("supports doctor-clinic scoped availability", async () => {
    const fixture = await createPublicFixture("doctor-clinic-availability");
    const slot = await createSlot(fixture, "14:00");

    const availability = await marketplace.listDoctorClinicAvailability(fixture.doctorClinicId, {
      fromDate: testDate,
      toDate: testDate,
      limit: 50
    });

    expect(availability.availability).toEqual([
      expect.objectContaining({
        slotId: slot.id,
        doctorClinicId: fixture.doctorClinicId
      })
    ]);
  });

  async function createPublicFixture(prefix: string) {
    const specialty = await prisma.specialty.create({
      data: {
        name: `Public Specialty ${prefix}`,
        slug: uniqueSlug(`${prefix}-specialty`),
        isActive: true
      }
    });
    const doctor = await createDoctor("Visible Public Doctor", DoctorStatus.APPROVED, {
      specialtyId: specialty.id
    });
    const clinic = await prisma.clinic.create({
      data: {
        name: `Visible Public Clinic ${prefix}`,
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode: PaymentMode.PAY_AT_CLINIC
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        name: "Main Branch",
        address: "10 Public Street",
        city: "Colombo",
        district: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE,
        isPrimary: true
      }
    });
    const service = await prisma.service.create({
      data: {
        name: "Public Consultation",
        slug: uniqueSlug(`${prefix}-service`),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId: clinic.id,
        serviceId: service.id,
        isActive: true
      }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        status: ClinicAssociationStatus.APPROVED,
        defaultConsultationFeeMinor: 345000n,
        currency: "LKR",
        paymentMode: null,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: null,
        currency: "LKR",
        paymentMode: null,
        isActive: true
      }
    });
    await prisma.doctorRatingSummary.create({
      data: {
        doctorId: doctor.id,
        averageRating: 4.75,
        reviewCount: 12
      }
    });

    return {
      specialtyId: specialty.id,
      doctorId: doctor.id,
      doctorSlug: doctor.slug,
      clinicId: clinic.id,
      clinicSlug: clinic.slug,
      clinicLocationId: clinicLocation.id,
      serviceId: service.id,
      doctorClinicId: doctorClinic.id,
      doctorClinicServiceId: doctorClinicService.id
    };
  }

  async function createDoctor(
    fullName: string,
    status: DoctorStatus,
    options: { specialtyId?: string } = {}
  ) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("public-doctor"),
        fullName,
        status: UserStatus.ACTIVE
      }
    });

    return prisma.doctor.create({
      data: {
        userId: user.id,
        slug: uniqueSlug("public-doctor"),
        licenseNumber: `SLMC-${randomUUID()}`,
        status,
        languages: ["en", "si"],
        yearsExperience: 8,
        specialties: options.specialtyId
          ? {
              create: {
                specialtyId: options.specialtyId,
                isPrimary: true
              }
            }
          : undefined
      }
    });
  }

  async function createSlot(
    fixture: {
      doctorClinicId: string;
      doctorClinicServiceId: string;
    },
    localStartTime: string
  ) {
    const startsAt = colomboUtc(testDate, localStartTime);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    return prisma.appointmentSlot.create({
      data: {
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceId,
        startsAt,
        endsAt,
        capacity: 1,
        isActive: true
      }
    });
  }

  async function createAppointmentForSlot(
    fixture: {
      doctorId: string;
      clinicId: string;
      clinicLocationId: string;
      doctorClinicId: string;
      doctorClinicServiceId: string;
    },
    slot: { id: string; startsAt: Date; endsAt: Date },
    status: AppointmentStatus
  ) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail("public-patient"),
        fullName: "Public Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: { userId: patientUser.id }
    });
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: fixture.doctorId,
        clinicId: fixture.clinicId,
        clinicLocationId: fixture.clinicLocationId,
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceId,
        slotId: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Public Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 345000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Public Patient"
      }
    });

    return {
      id: appointment.id,
      userId: patientUser.id
    };
  }
});

function colomboUtc(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;

  return new Date(`${date}T${normalized}+05:30`);
}
