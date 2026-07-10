import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const runDatabaseTests =
  process.env.RUN_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;

const prisma = new PrismaClient();

type Baseline = {
  patientUserId: string;
  doctorUserId: string;
  adminUserId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  locationId: string;
  serviceId: string;
  clinicServiceId: string;
  doctorClinicId: string;
  doctorClinicServiceId: string;
};

async function createBaseline(): Promise<Baseline> {
  const suffix = randomUUID();
  const baseline: Baseline = {
    patientUserId: randomUUID(),
    doctorUserId: randomUUID(),
    adminUserId: randomUUID(),
    patientId: randomUUID(),
    doctorId: randomUUID(),
    clinicId: randomUUID(),
    locationId: randomUUID(),
    serviceId: randomUUID(),
    clinicServiceId: randomUUID(),
    doctorClinicId: randomUUID(),
    doctorClinicServiceId: randomUUID(),
  };

  await prisma.$executeRaw`
    INSERT INTO "users" ("id", "email", "full_name", "status", "updated_at")
    VALUES
      (${baseline.patientUserId}::uuid, ${`patient-${suffix}@example.test`}::citext, 'Patient Test', 'active'::user_status, now()),
      (${baseline.doctorUserId}::uuid, ${`doctor-${suffix}@example.test`}::citext, 'Doctor Test', 'active'::user_status, now()),
      (${baseline.adminUserId}::uuid, ${`admin-${suffix}@example.test`}::citext, 'Admin Test', 'active'::user_status, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "patients" ("id", "user_id", "updated_at")
    VALUES (${baseline.patientId}::uuid, ${baseline.patientUserId}::uuid, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "doctors" ("id", "user_id", "slug", "status", "updated_at")
    VALUES (${baseline.doctorId}::uuid, ${baseline.doctorUserId}::uuid, ${`doctor-${suffix}`}, 'approved'::doctor_status, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "clinics" ("id", "name", "slug", "status", "updated_at")
    VALUES (${baseline.clinicId}::uuid, 'Clinic Test', ${`clinic-${suffix}`}, 'active'::clinic_status, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "clinic_locations" ("id", "clinic_id", "address", "city", "status", "updated_at")
    VALUES (${baseline.locationId}::uuid, ${baseline.clinicId}::uuid, '123 Test Street', 'Colombo', 'active'::clinic_status, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "services" ("id", "name", "slug", "default_duration_minutes", "updated_at")
    VALUES (${baseline.serviceId}::uuid, 'General Consultation', ${`general-${suffix}`}, 30, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "clinic_services" ("id", "clinic_id", "service_id", "updated_at")
    VALUES (${baseline.clinicServiceId}::uuid, ${baseline.clinicId}::uuid, ${baseline.serviceId}::uuid, now())
  `;

  await prisma.$executeRaw`
    INSERT INTO "doctor_clinics" (
      "id", "doctor_id", "clinic_id", "clinic_location_id", "status", "approved_by_user_id", "approved_at", "updated_at"
    )
    VALUES (
      ${baseline.doctorClinicId}::uuid,
      ${baseline.doctorId}::uuid,
      ${baseline.clinicId}::uuid,
      ${baseline.locationId}::uuid,
      'approved'::clinic_association_status,
      ${baseline.adminUserId}::uuid,
      now(),
      now()
    )
  `;

  await prisma.$executeRaw`
    INSERT INTO "doctor_clinic_services" (
      "id", "doctor_clinic_id", "clinic_service_id", "duration_minutes", "fee_minor", "updated_at"
    )
    VALUES (
      ${baseline.doctorClinicServiceId}::uuid,
      ${baseline.doctorClinicId}::uuid,
      ${baseline.clinicServiceId}::uuid,
      30,
      250000,
      now()
    )
  `;

  return baseline;
}

async function createAppointment(
  baseline: Baseline,
  startsAt: Date,
  endsAt: Date,
  overrides: {
    id?: string;
    number?: string;
    slotId?: string | null;
    status?: "confirmed" | "completed" | "pending_payment";
    source?: "patient_web" | "doctor_portal" | "receptionist_portal" | "admin_dashboard";
    isManualOverride?: boolean;
    manualOverrideReason?: string | null;
    patientId?: string;
    attendingPatientId?: string;
    completedAt?: Date | null;
  } = {},
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  const patientId = overrides.patientId ?? baseline.patientId;
  const attendingPatientId = overrides.attendingPatientId ?? patientId;
  const status = overrides.status ?? "confirmed";

  await prisma.$executeRaw`
    INSERT INTO "appointments" (
      "id",
      "appointment_number",
      "patient_id",
      "doctor_id",
      "clinic_id",
      "clinic_location_id",
      "doctor_clinic_id",
      "doctor_clinic_service_id",
      "slot_id",
      "is_manual_override",
      "manual_override_reason",
      "starts_at",
      "ends_at",
      "status",
      "source",
      "payment_mode",
      "service_name_snapshot",
      "service_duration_minutes",
      "fee_minor",
      "currency",
      "attending_patient_id",
      "attending_name_snapshot",
      "completed_at",
      "updated_at"
    )
    VALUES (
      ${id}::uuid,
      ${overrides.number ?? `APT-${randomUUID()}`},
      ${patientId}::uuid,
      ${baseline.doctorId}::uuid,
      ${baseline.clinicId}::uuid,
      ${baseline.locationId}::uuid,
      ${baseline.doctorClinicId}::uuid,
      ${baseline.doctorClinicServiceId}::uuid,
      ${overrides.slotId ?? null}::uuid,
      ${overrides.isManualOverride ?? false},
      ${overrides.manualOverrideReason ?? null},
      ${startsAt},
      ${endsAt},
      ${status}::appointment_status,
      ${overrides.source ?? "patient_web"}::appointment_source,
      'online_required'::payment_mode,
      'General Consultation',
      30,
      250000,
      'LKR',
      ${attendingPatientId}::uuid,
      'Patient Test',
      ${overrides.completedAt ?? null},
      now()
    )
  `;

  return id;
}

describeDatabase("database integrity constraints", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects verification tokens without a target", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "verification_tokens" ("token_hash", "purpose", "expires_at")
        VALUES (${`hash-${randomUUID()}`}, 'password_reset', now() + interval '15 minutes')
      `,
    ).rejects.toThrow();
  });

  it("rejects overlapping active appointments for the same doctor", async () => {
    const baseline = await createBaseline();
    const startsAt = new Date("2035-01-01T04:00:00.000Z");
    const endsAt = new Date("2035-01-01T04:30:00.000Z");

    await createAppointment(baseline, startsAt, endsAt);

    await expect(
      createAppointment(
        baseline,
        new Date("2035-01-01T04:15:00.000Z"),
        new Date("2035-01-01T04:45:00.000Z"),
      ),
    ).rejects.toThrow();
  });

  it("allows an expired hold to be replaced but rejects two active holds for one slot", async () => {
    const baseline = await createBaseline();
    const slotId = randomUUID();
    const startsAt = new Date("2035-01-02T04:00:00.000Z");
    const endsAt = new Date("2035-01-02T04:30:00.000Z");

    await prisma.$executeRaw`
      INSERT INTO "appointment_slots" (
        "id", "doctor_clinic_id", "doctor_clinic_service_id", "starts_at", "ends_at", "updated_at"
      )
      VALUES (
        ${slotId}::uuid,
        ${baseline.doctorClinicId}::uuid,
        ${baseline.doctorClinicServiceId}::uuid,
        ${startsAt},
        ${endsAt},
        now()
      )
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "appointment_slot_holds" (
          "slot_id", "user_id", "idempotency_key", "status", "expires_at", "updated_at"
        )
        VALUES (
          ${slotId}::uuid,
          ${baseline.patientUserId}::uuid,
          ${`orphan-${randomUUID()}`},
          'active'::slot_hold_status,
          now() + interval '5 minutes',
          now()
        )
      `,
    ).rejects.toThrow();

    await prisma.$executeRaw`
      INSERT INTO "appointment_slot_holds" (
        "slot_id", "user_id", "idempotency_key", "status", "expires_at", "resolved_at", "updated_at"
      )
      VALUES (
        ${slotId}::uuid,
        ${baseline.patientUserId}::uuid,
        ${`expired-${randomUUID()}`},
        'expired'::slot_hold_status,
        now() + interval '5 minutes',
        now(),
        now()
      )
    `;

    const appointmentId = await createAppointment(baseline, startsAt, endsAt, { slotId });

    await prisma.$executeRaw`
      INSERT INTO "appointment_slot_holds" (
        "slot_id", "user_id", "appointment_id", "idempotency_key", "status", "expires_at", "updated_at"
      )
      VALUES (
        ${slotId}::uuid,
        ${baseline.patientUserId}::uuid,
        ${appointmentId}::uuid,
        ${`active-${randomUUID()}`},
        'active'::slot_hold_status,
        now() + interval '5 minutes',
        now()
      )
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "appointment_slot_holds" (
          "slot_id", "user_id", "appointment_id", "idempotency_key", "status", "expires_at", "updated_at"
        )
        VALUES (
          ${slotId}::uuid,
          ${baseline.patientUserId}::uuid,
          ${appointmentId}::uuid,
          ${`active-${randomUUID()}`},
          'active'::slot_hold_status,
          now() + interval '5 minutes',
          now()
        )
      `,
    ).rejects.toThrow();
  });

  it("rejects overlapping clinic and doctor schedules", async () => {
    const baseline = await createBaseline();

    await prisma.$executeRaw`
      INSERT INTO "clinic_location_hours" ("location_id", "day_of_week", "opens_at", "closes_at", "updated_at")
      VALUES (${baseline.locationId}::uuid, 1, '09:00'::time, '13:00'::time, now())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "clinic_location_hours" ("location_id", "day_of_week", "opens_at", "closes_at", "updated_at")
        VALUES (${baseline.locationId}::uuid, 1, '12:00'::time, '16:00'::time, now())
      `,
    ).rejects.toThrow();

    await prisma.$executeRaw`
      INSERT INTO "doctor_availability_rules" ("doctor_clinic_id", "day_of_week", "starts_at", "ends_at", "updated_at")
      VALUES (${baseline.doctorClinicId}::uuid, 2, '09:00'::time, '13:00'::time, now())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "doctor_availability_rules" ("doctor_clinic_id", "day_of_week", "starts_at", "ends_at", "updated_at")
        VALUES (${baseline.doctorClinicId}::uuid, 2, '12:00'::time, '16:00'::time, now())
      `,
    ).rejects.toThrow();
  });

  it("rejects service, payment, refund, review, scope, and manual override violations", async () => {
    const baseline = await createBaseline();
    const otherClinicId = randomUUID();
    const otherLocationId = randomUUID();
    const otherServiceId = randomUUID();
    const otherClinicServiceId = randomUUID();
    const appointmentId = await createAppointment(
      baseline,
      new Date("2035-01-03T04:00:00.000Z"),
      new Date("2035-01-03T04:30:00.000Z"),
    );
    const paymentId = randomUUID();
    const secondPatientUserId = randomUUID();
    const secondPatientId = randomUUID();
    const permissionId = randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "full_name", "status", "updated_at")
      VALUES (${secondPatientUserId}::uuid, ${`other-${randomUUID()}@example.test`}::citext, 'Other Patient', 'active'::user_status, now())
    `;
    await prisma.$executeRaw`
      INSERT INTO "patients" ("id", "user_id", "updated_at")
      VALUES (${secondPatientId}::uuid, ${secondPatientUserId}::uuid, now())
    `;

    await prisma.$executeRaw`
      INSERT INTO "clinics" ("id", "name", "slug", "status", "updated_at")
      VALUES (${otherClinicId}::uuid, 'Other Clinic', ${`other-clinic-${randomUUID()}`}, 'active'::clinic_status, now())
    `;
    await prisma.$executeRaw`
      INSERT INTO "clinic_locations" ("id", "clinic_id", "address", "city", "status", "updated_at")
      VALUES (${otherLocationId}::uuid, ${otherClinicId}::uuid, '456 Other Street', 'Colombo', 'active'::clinic_status, now())
    `;
    await prisma.$executeRaw`
      INSERT INTO "services" ("id", "name", "slug", "default_duration_minutes", "updated_at")
      VALUES (${otherServiceId}::uuid, 'Other Consultation', ${`other-service-${randomUUID()}`}, 30, now())
    `;
    await prisma.$executeRaw`
      INSERT INTO "clinic_services" ("id", "clinic_id", "service_id", "updated_at")
      VALUES (${otherClinicServiceId}::uuid, ${otherClinicId}::uuid, ${otherServiceId}::uuid, now())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "doctor_clinic_services" (
          "doctor_clinic_id", "clinic_service_id", "duration_minutes", "fee_minor", "updated_at"
        )
        VALUES (${baseline.doctorClinicId}::uuid, ${otherClinicServiceId}::uuid, 30, 250000, now())
      `,
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "appointment_slots" (
          "doctor_clinic_id", "doctor_clinic_service_id", "starts_at", "ends_at", "updated_at"
        )
        VALUES (
          ${baseline.doctorClinicId}::uuid,
          ${baseline.doctorClinicServiceId}::uuid,
          ${new Date("2035-01-03T05:00:00.000Z")},
          ${new Date("2035-01-03T05:45:00.000Z")},
          now()
        )
      `,
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "payments" ("appointment_id", "patient_id", "provider", "amount_minor", "status", "updated_at")
        VALUES (${appointmentId}::uuid, ${secondPatientId}::uuid, 'stripe', 250000, 'initiated'::payment_status, now())
      `,
    ).rejects.toThrow();

    await prisma.$executeRaw`
      INSERT INTO "payments" ("id", "appointment_id", "patient_id", "provider", "amount_minor", "status", "paid_at", "updated_at")
      VALUES (${paymentId}::uuid, ${appointmentId}::uuid, ${baseline.patientId}::uuid, 'stripe', 100, 'successful'::payment_status, now(), now())
    `;

    await prisma.$executeRaw`
      INSERT INTO "refunds" (
        "payment_id", "appointment_id", "requested_by_user_id", "reviewed_by_user_id", "provider", "amount_minor", "status", "reason", "reviewed_at", "updated_at"
      )
      VALUES (
        ${paymentId}::uuid,
        ${appointmentId}::uuid,
        ${baseline.adminUserId}::uuid,
        ${baseline.adminUserId}::uuid,
        'stripe',
        80,
        'approved'::refund_status,
        'Patient cancellation',
        now(),
        now()
      )
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "refunds" (
          "payment_id", "appointment_id", "requested_by_user_id", "reviewed_by_user_id", "provider", "amount_minor", "status", "reason", "reviewed_at", "updated_at"
        )
        VALUES (
          ${paymentId}::uuid,
          ${appointmentId}::uuid,
          ${baseline.adminUserId}::uuid,
          ${baseline.adminUserId}::uuid,
          'stripe',
          30,
          'approved'::refund_status,
          'Patient cancellation',
          now(),
          now()
        )
      `,
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "reviews" ("appointment_id", "patient_id", "doctor_id", "clinic_id", "rating", "updated_at")
        VALUES (${appointmentId}::uuid, ${baseline.patientId}::uuid, ${baseline.doctorId}::uuid, ${baseline.clinicId}::uuid, 5, now())
      `,
    ).rejects.toThrow();

    await prisma.$executeRaw`
      INSERT INTO "permissions" ("id", "code", "module")
      VALUES (${permissionId}::uuid, ${`clinic.read.${randomUUID()}`}, 'clinics')
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "user_permission_grants" ("user_id", "permission_id", "scope_type", "scope_id")
        VALUES (${baseline.adminUserId}::uuid, ${permissionId}::uuid, 'clinic'::scope_type, ${randomUUID()}::uuid)
      `,
    ).rejects.toThrow();

    await expect(
      createAppointment(
        baseline,
        new Date("2035-01-03T06:00:00.000Z"),
        new Date("2035-01-03T06:30:00.000Z"),
        {
          source: "patient_web",
          isManualOverride: true,
          manualOverrideReason: "Walk-in exception",
        },
      ),
    ).rejects.toThrow();
  });
});
