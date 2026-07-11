import { randomUUID } from "node:crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PrismaClient,
  UserStatus
} from "@doctobook/database";
import { SlotGenerationService } from "@doctobook/slots";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV ??= "test";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const testDate = "2036-01-07";
const dayOfWeek = getDayOfWeek(testDate);

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describeDatabase("materialized slot generation", () => {
  let prisma: PrismaClient;
  let slots: SlotGenerationService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    slots = new SlotGenerationService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("generates UTC slots from local clinic timezone windows", async () => {
    const fixture = await createSlotFixture({
      prefix: "basic-slots",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "12:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "12:00",
      defaultSlotIntervalMinutes: 15,
      serviceDurations: [30]
    });

    const result = await generate(fixture.doctorClinicId);
    const generatedSlots = await listSlots(fixture.doctorClinicId);

    expect(result.insertedCount).toBe(11);
    expect(generatedSlots).toHaveLength(11);
    expect(generatedSlots[0]).toEqual(
      expect.objectContaining({
        startsAt: colomboUtc(testDate, "09:00"),
        endsAt: colomboUtc(testDate, "09:30")
      })
    );
    expect(generatedSlots.at(-1)).toEqual(
      expect.objectContaining({
        startsAt: colomboUtc(testDate, "11:30"),
        endsAt: colomboUtc(testDate, "12:00")
      })
    );
  });

  it("uses doctor-clinic slot interval fallback and service-specific durations", async () => {
    const fixture = await createSlotFixture({
      prefix: "duration-fallback",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "12:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "12:00",
      defaultSlotIntervalMinutes: 20,
      ruleSlotIntervalMinutes: null,
      serviceDurations: [30, 45]
    });

    await generate(fixture.doctorClinicId);

    const firstServiceCount = await prisma.appointmentSlot.count({
      where: {
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceIds[0]
      }
    });
    const secondServiceCount = await prisma.appointmentSlot.count({
      where: {
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceIds[1]
      }
    });

    expect(firstServiceCount).toBe(8);
    expect(secondServiceCount).toBe(7);
  });

  it("uses availability-rule slot interval override when configured", async () => {
    const fixture = await createSlotFixture({
      prefix: "interval-override",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "12:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "12:00",
      defaultSlotIntervalMinutes: 15,
      ruleSlotIntervalMinutes: 30,
      serviceDurations: [30]
    });

    await generate(fixture.doctorClinicId);

    const generatedSlots = await listSlots(fixture.doctorClinicId);

    expect(generatedSlots).toHaveLength(6);
    expect(generatedSlots.map((slot) => slot.startsAt)).toEqual([
      colomboUtc(testDate, "09:00"),
      colomboUtc(testDate, "09:30"),
      colomboUtc(testDate, "10:00"),
      colomboUtc(testDate, "10:30"),
      colomboUtc(testDate, "11:00"),
      colomboUtc(testDate, "11:30")
    ]);
  });

  it("subtracts breaks, clinic closures, and service-specific time off", async () => {
    const fixture = await createSlotFixture({
      prefix: "slot-blockers",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "12:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "12:00",
      defaultSlotIntervalMinutes: 30,
      serviceDurations: [30]
    });

    await prisma.doctorAvailabilityBreak.create({
      data: {
        ruleId: fixture.availabilityRuleId,
        startsAt: timeToDate("10:00"),
        endsAt: timeToDate("10:30")
      }
    });
    await prisma.clinicLocationClosure.create({
      data: {
        locationId: fixture.clinicLocationId,
        startsAt: colomboUtc(testDate, "11:00"),
        endsAt: colomboUtc(testDate, "12:00"),
        reason: "Public holiday"
      }
    });
    await prisma.doctorTimeOff.create({
      data: {
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceIds[0],
        startsAt: colomboUtc(testDate, "09:30"),
        endsAt: colomboUtc(testDate, "10:00"),
        reason: "Service block"
      }
    });

    await generate(fixture.doctorClinicId);

    const generatedSlots = await listSlots(fixture.doctorClinicId);

    expect(generatedSlots.map((slot) => slot.startsAt)).toEqual([
      colomboUtc(testDate, "09:00"),
      colomboUtc(testDate, "10:30")
    ]);
  });

  it("is idempotent and safe when the same range is generated concurrently", async () => {
    const fixture = await createSlotFixture({
      prefix: "concurrent-slots",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "10:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "10:00",
      defaultSlotIntervalMinutes: 15,
      serviceDurations: [30]
    });

    await Promise.all([generate(fixture.doctorClinicId), generate(fixture.doctorClinicId)]);
    await generate(fixture.doctorClinicId);

    const generatedSlots = await listSlots(fixture.doctorClinicId);

    expect(generatedSlots).toHaveLength(3);
    expect(new Set(generatedSlots.map((slot) => slot.startsAt.toISOString())).size).toBe(3);
  });

  it("deactivates obsolete unbooked slots but preserves booked slots", async () => {
    const fixture = await createSlotFixture({
      prefix: "obsolete-slots",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "12:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "12:00",
      defaultSlotIntervalMinutes: 30,
      serviceDurations: [30]
    });

    await generate(fixture.doctorClinicId);
    const bookedSlot = await prisma.appointmentSlot.findFirstOrThrow({
      where: {
        doctorClinicId: fixture.doctorClinicId,
        startsAt: colomboUtc(testDate, "11:30")
      }
    });
    await createAppointmentForSlot(fixture, bookedSlot.id, bookedSlot.startsAt, bookedSlot.endsAt);
    await prisma.doctorAvailabilityRule.update({
      where: { id: fixture.availabilityRuleId },
      data: { endsAt: timeToDate("10:00") }
    });

    const result = await generate(fixture.doctorClinicId);
    const activeSlots = await listSlots(fixture.doctorClinicId, true);
    const preservedBookedSlot = await prisma.appointmentSlot.findUniqueOrThrow({
      where: { id: bookedSlot.id }
    });

    expect(result.deactivatedCount).toBe(3);
    expect(activeSlots.map((slot) => slot.startsAt)).toEqual([
      colomboUtc(testDate, "09:00"),
      colomboUtc(testDate, "09:30"),
      colomboUtc(testDate, "11:30")
    ]);
    expect(preservedBookedSlot.isActive).toBe(true);
  });

  it("deactivates future unbooked slots when the clinic is no longer active", async () => {
    const fixture = await createSlotFixture({
      prefix: "inactive-clinic",
      availabilityStartsAt: "09:00",
      availabilityEndsAt: "10:00",
      clinicOpensAt: "09:00",
      clinicClosesAt: "10:00",
      defaultSlotIntervalMinutes: 15,
      serviceDurations: [30]
    });

    await generate(fixture.doctorClinicId);
    await prisma.clinic.update({
      where: { id: fixture.clinicId },
      data: { status: ClinicStatus.SUSPENDED }
    });

    const result = await generate(fixture.doctorClinicId);
    const activeSlotCount = await prisma.appointmentSlot.count({
      where: { doctorClinicId: fixture.doctorClinicId, isActive: true }
    });

    expect(result.deactivatedCount).toBe(3);
    expect(activeSlotCount).toBe(0);
  });

  async function generate(doctorClinicId: string) {
    return slots.generateRange({
      doctorClinicId,
      fromDate: testDate,
      toDate: testDate,
      reason: "manual"
    });
  }

  async function createSlotFixture(input: {
    prefix: string;
    availabilityStartsAt: string;
    availabilityEndsAt: string;
    clinicOpensAt: string;
    clinicClosesAt: string;
    defaultSlotIntervalMinutes: number;
    ruleSlotIntervalMinutes?: number | null;
    serviceDurations: number[];
  }) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(input.prefix),
        fullName: "Slot Test Doctor",
        status: UserStatus.ACTIVE
      },
      select: { id: true }
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        slug: uniqueSlug(input.prefix),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      },
      select: { id: true }
    });
    const clinic = await prisma.clinic.create({
      data: {
        name: "Slot Test Clinic",
        slug: uniqueSlug(input.prefix),
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "123 Slot Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      },
      select: { id: true }
    });
    await prisma.clinicLocationHour.create({
      data: {
        locationId: clinicLocation.id,
        dayOfWeek,
        opensAt: timeToDate(input.clinicOpensAt),
        closesAt: timeToDate(input.clinicClosesAt),
        isClosed: false
      }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        status: ClinicAssociationStatus.APPROVED,
        currency: "LKR",
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        defaultSlotIntervalMinutes: input.defaultSlotIntervalMinutes,
        bufferMinutes: 0
      },
      select: { id: true }
    });
    const availabilityRule = await prisma.doctorAvailabilityRule.create({
      data: {
        doctorClinicId: doctorClinic.id,
        dayOfWeek,
        startsAt: timeToDate(input.availabilityStartsAt),
        endsAt: timeToDate(input.availabilityEndsAt),
        slotIntervalMinutes: input.ruleSlotIntervalMinutes,
        maxPatients: 1,
        isActive: true
      },
      select: { id: true }
    });
    const doctorClinicServiceIds = [];

    for (const [index, durationMinutes] of input.serviceDurations.entries()) {
      const service = await prisma.service.create({
        data: {
          name: `Slot Consultation ${input.prefix} ${index}`,
          slug: uniqueSlug(`${input.prefix}-service-${index}`),
          defaultDurationMinutes: durationMinutes,
          isActive: true
        },
        select: { id: true }
      });
      const clinicService = await prisma.clinicService.create({
        data: {
          clinicId: clinic.id,
          serviceId: service.id,
          isActive: true
        },
        select: { id: true }
      });
      const doctorClinicService = await prisma.doctorClinicService.create({
        data: {
          doctorClinicId: doctorClinic.id,
          clinicServiceId: clinicService.id,
          durationMinutes,
          feeMinor: 250000n,
          currency: "LKR",
          paymentMode: PaymentMode.PAY_AT_CLINIC,
          isActive: true
        },
        select: { id: true }
      });

      doctorClinicServiceIds.push(doctorClinicService.id);
    }

    return {
      clinicId: clinic.id,
      clinicLocationId: clinicLocation.id,
      doctorId: doctor.id,
      doctorClinicId: doctorClinic.id,
      availabilityRuleId: availabilityRule.id,
      doctorClinicServiceIds
    };
  }

  async function listSlots(doctorClinicId: string, activeOnly = false) {
    return prisma.appointmentSlot.findMany({
      where: {
        doctorClinicId,
        ...(activeOnly ? { isActive: true } : {})
      },
      orderBy: [{ startsAt: "asc" }, { doctorClinicServiceId: "asc" }]
    });
  }

  async function createAppointmentForSlot(
    fixture: {
      clinicId: string;
      clinicLocationId: string;
      doctorId: string;
      doctorClinicId: string;
      doctorClinicServiceIds: string[];
    },
    slotId: string,
    startsAt: Date,
    endsAt: Date
  ) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail("slot-patient"),
        fullName: "Slot Test Patient",
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
        doctorId: fixture.doctorId,
        clinicId: fixture.clinicId,
        clinicLocationId: fixture.clinicLocationId,
        doctorClinicId: fixture.doctorClinicId,
        doctorClinicServiceId: fixture.doctorClinicServiceIds[0],
        slotId,
        startsAt,
        endsAt,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ADMIN_DASHBOARD,
        paymentMode: PaymentMode.PAY_AT_CLINIC,
        serviceNameSnapshot: "Slot Consultation",
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: "Slot Test Patient"
      },
      select: { id: true }
    });
  }
});

function timeToDate(value: string) {
  const normalized = value.length === 5 ? `${value}:00` : value;

  return new Date(`1970-01-01T${normalized}.000Z`);
}

function colomboUtc(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;

  return new Date(`${date}T${normalized}+05:30`);
}

function getDayOfWeek(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}
