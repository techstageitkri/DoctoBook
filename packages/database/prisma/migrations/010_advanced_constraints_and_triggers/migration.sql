-- Database-generated UUIDs for non-Prisma writers, imports, and integration tests.
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "auth_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "verification_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "roles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "permissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user_permission_grants" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "uploaded_files" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "patients" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "patient_dependents" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinics" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinic_locations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinic_location_hours" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinic_location_closures" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinic_admins" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "receptionists" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctors" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_documents" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_document_clinic_reviews" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "specialties" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "services" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "clinic_services" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_clinics" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_clinic_services" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_availability_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_availability_breaks" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "doctor_time_off" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "appointment_slots" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "appointment_slot_holds" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "appointments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "appointment_status_history" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "appointment_reschedule_requests" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "payments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "payment_webhook_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "refunds" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "payment_status_history" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "refund_status_history" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "reviews" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "notification_templates" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "notification_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user_push_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "system_settings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "provider_configurations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "consent_records" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "translations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "users_email_active_uidx"
    ON "users" ("email")
    WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "users_phone_active_uidx"
    ON "users" ("phone")
    WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "clinics_slug_active_uidx"
    ON "clinics" ("slug")
    WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "doctors_slug_active_uidx"
    ON "doctors" ("slug")
    WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "doctors_license_number_active_uidx"
    ON "doctors" ("license_number")
    WHERE "license_number" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "doctor_clinics_active_assignment_uidx"
    ON "doctor_clinics" ("doctor_id", "clinic_id", "clinic_location_id")
    WHERE "deleted_at" IS NULL AND "status" IN ('pending', 'approved');

CREATE UNIQUE INDEX "doctor_clinic_services_active_uidx"
    ON "doctor_clinic_services" ("doctor_clinic_id", "clinic_service_id")
    WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "appointment_slot_holds_one_active_per_slot_uidx"
    ON "appointment_slot_holds" ("slot_id")
    WHERE "status" = 'active';

CREATE UNIQUE INDEX "notification_templates_scope_event_channel_locale_uidx"
    ON "notification_templates" (
        "scope_type",
        COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "event_code",
        "channel",
        "locale"
    );

CREATE UNIQUE INDEX "system_settings_scope_key_uidx"
    ON "system_settings" (
        "scope_type",
        COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "key"
    );

CREATE UNIQUE INDEX "provider_configurations_scope_provider_uidx"
    ON "provider_configurations" (
        "provider_type",
        "provider_code",
        "scope_type",
        COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)
    );

CREATE UNIQUE INDEX "translations_entity_field_locale_uidx"
    ON "translations" (
        "entity_type",
        COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "field_name",
        "locale"
    );

ALTER TABLE "users"
    ADD CONSTRAINT "users_login_identity_chk"
    CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

ALTER TABLE "auth_sessions"
    ADD CONSTRAINT "auth_sessions_time_chk"
    CHECK (
        "expires_at" > "created_at"
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
        AND ("last_used_at" IS NULL OR "last_used_at" >= "created_at")
    );

ALTER TABLE "verification_tokens"
    ADD CONSTRAINT "verification_tokens_target_chk"
    CHECK (
        "user_id" IS NOT NULL
        OR "email" IS NOT NULL
        OR "phone" IS NOT NULL
    ),
    ADD CONSTRAINT "verification_tokens_purpose_target_chk"
    CHECK (
        ("purpose" = 'email_verification' AND ("user_id" IS NOT NULL OR "email" IS NOT NULL))
        OR ("purpose" = 'phone_verification' AND ("user_id" IS NOT NULL OR "phone" IS NOT NULL))
        OR ("purpose" = 'password_reset' AND "user_id" IS NOT NULL)
        OR ("purpose" = 'doctor_invitation' AND ("email" IS NOT NULL OR "phone" IS NOT NULL))
        OR ("purpose" = 'clinic_admin_invitation' AND ("email" IS NOT NULL OR "phone" IS NOT NULL))
        OR ("purpose" NOT IN (
            'email_verification',
            'phone_verification',
            'password_reset',
            'doctor_invitation',
            'clinic_admin_invitation'
        ))
    ),
    ADD CONSTRAINT "verification_tokens_used_before_expiry_chk"
    CHECK ("used_at" IS NULL OR "used_at" <= "expires_at");

ALTER TABLE "clinic_location_hours"
    ADD CONSTRAINT "clinic_location_hours_day_chk"
    CHECK ("day_of_week" BETWEEN 0 AND 6),
    ADD CONSTRAINT "clinic_location_hours_open_close_chk"
    CHECK (
        ("is_closed" = true AND "opens_at" IS NULL AND "closes_at" IS NULL)
        OR ("is_closed" = false AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL AND "opens_at" < "closes_at")
    ),
    ADD CONSTRAINT "clinic_location_hours_effective_dates_chk"
    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "clinic_location_closures"
    ADD CONSTRAINT "clinic_location_closures_time_chk"
    CHECK ("ends_at" > "starts_at");

ALTER TABLE "doctor_availability_rules"
    ADD CONSTRAINT "doctor_availability_rules_day_chk"
    CHECK ("day_of_week" BETWEEN 0 AND 6),
    ADD CONSTRAINT "doctor_availability_rules_time_chk"
    CHECK ("starts_at" < "ends_at"),
    ADD CONSTRAINT "doctor_availability_rules_capacity_chk"
    CHECK ("max_patients" > 0),
    ADD CONSTRAINT "doctor_availability_rules_effective_dates_chk"
    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "doctor_availability_breaks"
    ADD CONSTRAINT "doctor_availability_breaks_time_chk"
    CHECK ("starts_at" < "ends_at");

ALTER TABLE "doctor_time_off"
    ADD CONSTRAINT "doctor_time_off_time_chk"
    CHECK ("ends_at" > "starts_at");

ALTER TABLE "appointment_slots"
    ADD CONSTRAINT "appointment_slots_time_capacity_chk"
    CHECK ("ends_at" > "starts_at" AND "capacity" > 0);

ALTER TABLE "appointment_slot_holds"
    ADD CONSTRAINT "appointment_slot_holds_expiry_chk"
    CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "appointment_slot_holds_resolved_state_chk"
    CHECK (
        ("status" = 'active' AND "resolved_at" IS NULL)
        OR ("status" <> 'active' AND "resolved_at" IS NOT NULL)
    );

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_time_chk"
    CHECK ("ends_at" > "starts_at"),
    ADD CONSTRAINT "appointments_manual_override_chk"
    CHECK (
        "is_manual_override" = false
        OR (
            "manual_override_reason" IS NOT NULL
            AND length(btrim("manual_override_reason")) > 0
            AND "source" IN ('doctor_portal', 'receptionist_portal', 'admin_dashboard', 'imported')
        )
    ),
    ADD CONSTRAINT "appointments_attending_target_chk"
    CHECK (
        ("attending_patient_id" IS NOT NULL AND "attending_dependent_id" IS NULL)
        OR ("attending_patient_id" IS NULL AND "attending_dependent_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "appointments_status_timestamp_chk"
    CHECK (
        ("status" <> 'checked_in' OR "checked_in_at" IS NOT NULL)
        AND ("status" <> 'in_progress' OR "consultation_started_at" IS NOT NULL)
        AND ("status" <> 'completed' OR "completed_at" IS NOT NULL)
        AND ("status" NOT IN ('cancelled_by_patient', 'cancelled_by_clinic', 'cancelled_by_admin') OR "cancelled_at" IS NOT NULL)
    );

ALTER TABLE "appointment_reschedule_requests"
    ADD CONSTRAINT "appointment_reschedule_requests_time_chk"
    CHECK ("old_ends_at" > "old_starts_at" AND "new_ends_at" > "new_starts_at"),
    ADD CONSTRAINT "appointment_reschedule_requests_fee_chk"
    CHECK ("old_fee_minor" >= 0 AND "new_fee_minor" >= 0),
    ADD CONSTRAINT "appointment_reschedule_requests_resolved_at_chk"
    CHECK (
        ("status" IN ('approved', 'rejected', 'applied') AND "resolved_at" IS NOT NULL)
        OR ("status" NOT IN ('approved', 'rejected', 'applied'))
    );

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_amount_chk"
    CHECK ("amount_minor" > 0),
    ADD CONSTRAINT "payments_paid_at_chk"
    CHECK ("status" <> 'successful' OR "paid_at" IS NOT NULL);

ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_amount_reason_chk"
    CHECK ("amount_minor" > 0 AND length(btrim("reason")) > 0),
    ADD CONSTRAINT "refunds_reviewed_at_chk"
    CHECK (
        ("status" IN ('approved', 'rejected') AND "reviewed_at" IS NOT NULL)
        OR ("status" NOT IN ('approved', 'rejected'))
    ),
    ADD CONSTRAINT "refunds_processed_at_chk"
    CHECK (
        ("status" IN ('processed', 'failed') AND "processed_at" IS NOT NULL)
        OR ("status" NOT IN ('processed', 'failed'))
    );

ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_rating_chk"
    CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "doctor_rating_summaries"
    ADD CONSTRAINT "doctor_rating_summaries_value_chk"
    CHECK ("average_rating" >= 0 AND "average_rating" <= 5 AND "review_count" >= 0);

ALTER TABLE "notification_logs"
    ADD CONSTRAINT "notification_logs_attempts_chk"
    CHECK ("attempts" >= 0);

ALTER TABLE "consent_records"
    ADD CONSTRAINT "consent_records_withdrawal_chk"
    CHECK ("withdrawn_at" IS NULL OR "withdrawn_at" >= "recorded_at");

ALTER TABLE "notification_templates"
    ADD CONSTRAINT "notification_templates_scope_chk"
    CHECK (("scope_type" = 'platform' AND "scope_id" IS NULL) OR ("scope_type" <> 'platform' AND "scope_id" IS NOT NULL));

ALTER TABLE "system_settings"
    ADD CONSTRAINT "system_settings_scope_chk"
    CHECK (("scope_type" = 'platform' AND "scope_id" IS NULL) OR ("scope_type" <> 'platform' AND "scope_id" IS NOT NULL));

ALTER TABLE "provider_configurations"
    ADD CONSTRAINT "provider_configurations_scope_chk"
    CHECK (("scope_type" = 'platform' AND "scope_id" IS NULL) OR ("scope_type" <> 'platform' AND "scope_id" IS NOT NULL)),
    ADD CONSTRAINT "provider_configurations_payment_scope_chk"
    CHECK ("provider_type" <> 'payment' OR "scope_type" = 'platform');

CREATE OR REPLACE FUNCTION "validate_scope_target"("scope_type" scope_type, "scope_id" uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF "scope_type" = 'platform' THEN
        IF "scope_id" IS NOT NULL THEN
            RAISE EXCEPTION 'platform scope cannot have scope_id';
        END IF;
    ELSIF "scope_id" IS NULL THEN
        RAISE EXCEPTION '% scope requires scope_id', "scope_type";
    ELSIF "scope_type" = 'clinic' AND NOT EXISTS (SELECT 1 FROM "clinics" WHERE "id" = "scope_id") THEN
        RAISE EXCEPTION 'clinic scope target does not exist: %', "scope_id";
    ELSIF "scope_type" = 'clinic_location' AND NOT EXISTS (SELECT 1 FROM "clinic_locations" WHERE "id" = "scope_id") THEN
        RAISE EXCEPTION 'clinic_location scope target does not exist: %', "scope_id";
    ELSIF "scope_type" = 'doctor' AND NOT EXISTS (SELECT 1 FROM "doctors" WHERE "id" = "scope_id") THEN
        RAISE EXCEPTION 'doctor scope target does not exist: %', "scope_id";
    ELSIF "scope_type" = 'patient' AND NOT EXISTS (SELECT 1 FROM "patients" WHERE "id" = "scope_id") THEN
        RAISE EXCEPTION 'patient scope target does not exist: %', "scope_id";
    ELSIF "scope_type" = 'appointment' AND NOT EXISTS (SELECT 1 FROM "appointments" WHERE "id" = "scope_id") THEN
        RAISE EXCEPTION 'appointment scope target does not exist: %', "scope_id";
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_scoped_row"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM "validate_scope_target"(NEW."scope_type", NEW."scope_id");
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "user_permission_grants_scope_target_trg"
AFTER INSERT OR UPDATE OF "scope_type", "scope_id" ON "user_permission_grants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_scoped_row"();

CREATE CONSTRAINT TRIGGER "notification_templates_scope_target_trg"
AFTER INSERT OR UPDATE OF "scope_type", "scope_id" ON "notification_templates"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_scoped_row"();

CREATE CONSTRAINT TRIGGER "system_settings_scope_target_trg"
AFTER INSERT OR UPDATE OF "scope_type", "scope_id" ON "system_settings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_scoped_row"();

CREATE CONSTRAINT TRIGGER "provider_configurations_scope_target_trg"
AFTER INSERT OR UPDATE OF "scope_type", "scope_id" ON "provider_configurations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_scoped_row"();

CREATE OR REPLACE FUNCTION "validate_clinic_location_hours_no_overlap"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."is_closed" THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "clinic_location_hours" existing
        WHERE existing."id" <> NEW."id"
          AND existing."location_id" = NEW."location_id"
          AND existing."day_of_week" = NEW."day_of_week"
          AND existing."is_closed" = false
          AND daterange(COALESCE(existing."effective_from", '-infinity'::date), COALESCE(existing."effective_to", 'infinity'::date), '[]')
              && daterange(COALESCE(NEW."effective_from", '-infinity'::date), COALESCE(NEW."effective_to", 'infinity'::date), '[]')
          AND existing."opens_at" < NEW."closes_at"
          AND NEW."opens_at" < existing."closes_at"
    ) THEN
        RAISE EXCEPTION 'clinic location hours overlap for location % weekday %', NEW."location_id", NEW."day_of_week";
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "clinic_location_hours_no_overlap_trg"
BEFORE INSERT OR UPDATE ON "clinic_location_hours"
FOR EACH ROW EXECUTE FUNCTION "validate_clinic_location_hours_no_overlap"();

CREATE OR REPLACE FUNCTION "validate_doctor_availability_no_overlap"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."is_active" = false THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "doctor_availability_rules" existing
        WHERE existing."id" <> NEW."id"
          AND existing."doctor_clinic_id" = NEW."doctor_clinic_id"
          AND existing."day_of_week" = NEW."day_of_week"
          AND existing."is_active" = true
          AND daterange(COALESCE(existing."effective_from", '-infinity'::date), COALESCE(existing."effective_to", 'infinity'::date), '[]')
              && daterange(COALESCE(NEW."effective_from", '-infinity'::date), COALESCE(NEW."effective_to", 'infinity'::date), '[]')
          AND existing."starts_at" < NEW."ends_at"
          AND NEW."starts_at" < existing."ends_at"
    ) THEN
        RAISE EXCEPTION 'doctor availability overlaps for doctor_clinic % weekday %', NEW."doctor_clinic_id", NEW."day_of_week";
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "doctor_availability_rules_no_overlap_trg"
BEFORE INSERT OR UPDATE ON "doctor_availability_rules"
FOR EACH ROW EXECUTE FUNCTION "validate_doctor_availability_no_overlap"();

CREATE OR REPLACE FUNCTION "validate_doctor_clinic_location"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "clinic_locations" location
        WHERE location."id" = NEW."clinic_location_id"
          AND location."clinic_id" = NEW."clinic_id"
    ) THEN
        RAISE EXCEPTION 'doctor_clinic location does not belong to clinic';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "doctor_clinics_location_ownership_trg"
BEFORE INSERT OR UPDATE OF "clinic_id", "clinic_location_id" ON "doctor_clinics"
FOR EACH ROW EXECUTE FUNCTION "validate_doctor_clinic_location"();

CREATE OR REPLACE FUNCTION "validate_doctor_clinic_service"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "doctor_clinics" dc
        JOIN "clinic_services" cs ON cs."id" = NEW."clinic_service_id"
        WHERE dc."id" = NEW."doctor_clinic_id"
          AND cs."clinic_id" = dc."clinic_id"
    ) THEN
        RAISE EXCEPTION 'doctor_clinic_service clinic_service does not belong to doctor_clinic clinic';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "doctor_clinic_services_consistency_trg"
BEFORE INSERT OR UPDATE OF "doctor_clinic_id", "clinic_service_id" ON "doctor_clinic_services"
FOR EACH ROW EXECUTE FUNCTION "validate_doctor_clinic_service"();

CREATE OR REPLACE FUNCTION "validate_slot_service_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    service_duration integer;
BEGIN
    SELECT dcs."duration_minutes"
    INTO service_duration
    FROM "doctor_clinic_services" dcs
    WHERE dcs."id" = NEW."doctor_clinic_service_id"
      AND dcs."doctor_clinic_id" = NEW."doctor_clinic_id";

    IF service_duration IS NULL THEN
        RAISE EXCEPTION 'appointment slot service does not belong to doctor_clinic';
    END IF;

    IF NEW."ends_at" <> NEW."starts_at" + make_interval(mins => service_duration) THEN
        RAISE EXCEPTION 'appointment slot duration must match doctor_clinic_service duration';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "appointment_slots_service_consistency_trg"
BEFORE INSERT OR UPDATE OF "doctor_clinic_id", "doctor_clinic_service_id", "starts_at", "ends_at" ON "appointment_slots"
FOR EACH ROW EXECUTE FUNCTION "validate_slot_service_consistency"();

CREATE OR REPLACE FUNCTION "validate_doctor_time_off_service"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."doctor_clinic_service_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "doctor_clinic_services" dcs
           WHERE dcs."id" = NEW."doctor_clinic_service_id"
             AND dcs."doctor_clinic_id" = NEW."doctor_clinic_id"
       ) THEN
        RAISE EXCEPTION 'time off service does not belong to doctor_clinic';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "doctor_time_off_service_consistency_trg"
BEFORE INSERT OR UPDATE OF "doctor_clinic_id", "doctor_clinic_service_id" ON "doctor_time_off"
FOR EACH ROW EXECUTE FUNCTION "validate_doctor_time_off_service"();

CREATE OR REPLACE FUNCTION "validate_appointment_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    service_duration integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "doctor_clinics" dc
        WHERE dc."id" = NEW."doctor_clinic_id"
          AND dc."doctor_id" = NEW."doctor_id"
          AND dc."clinic_id" = NEW."clinic_id"
          AND dc."clinic_location_id" = NEW."clinic_location_id"
    ) THEN
        RAISE EXCEPTION 'appointment doctor_clinic snapshot is inconsistent';
    END IF;

    SELECT dcs."duration_minutes"
    INTO service_duration
    FROM "doctor_clinic_services" dcs
    WHERE dcs."id" = NEW."doctor_clinic_service_id"
      AND dcs."doctor_clinic_id" = NEW."doctor_clinic_id";

    IF service_duration IS NULL THEN
        RAISE EXCEPTION 'appointment service does not belong to doctor_clinic';
    END IF;

    IF NEW."service_duration_minutes" <> service_duration
       OR NEW."ends_at" <> NEW."starts_at" + make_interval(mins => NEW."service_duration_minutes") THEN
        RAISE EXCEPTION 'appointment duration snapshot is inconsistent with doctor_clinic_service';
    END IF;

    IF NEW."slot_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "appointment_slots" slot
        WHERE slot."id" = NEW."slot_id"
          AND slot."doctor_clinic_id" = NEW."doctor_clinic_id"
          AND slot."doctor_clinic_service_id" = NEW."doctor_clinic_service_id"
          AND slot."starts_at" = NEW."starts_at"
          AND slot."ends_at" = NEW."ends_at"
    ) THEN
        RAISE EXCEPTION 'appointment slot snapshot is inconsistent';
    END IF;

    IF NEW."attending_patient_id" IS NOT NULL AND NEW."attending_patient_id" <> NEW."patient_id" THEN
        RAISE EXCEPTION 'attending_patient_id must match patient_id';
    END IF;

    IF NEW."attending_dependent_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "patient_dependents" dependent
        WHERE dependent."id" = NEW."attending_dependent_id"
          AND dependent."patient_id" = NEW."patient_id"
    ) THEN
        RAISE EXCEPTION 'attending dependent does not belong to patient';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "appointments_consistency_trg"
BEFORE INSERT OR UPDATE OF "patient_id", "doctor_id", "clinic_id", "clinic_location_id", "doctor_clinic_id", "doctor_clinic_service_id", "slot_id", "starts_at", "ends_at", "service_duration_minutes", "attending_patient_id", "attending_dependent_id"
ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "validate_appointment_consistency"();

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_doctor_no_overlap_excl"
    EXCLUDE USING gist (
        "doctor_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
    WHERE ("status" IN ('pending_payment', 'confirmed', 'checked_in', 'waiting', 'in_progress', 'completed'));

CREATE OR REPLACE FUNCTION "validate_slot_hold_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" IN ('active', 'converted') AND NEW."appointment_id" IS NULL THEN
        RAISE EXCEPTION 'active or converted slot hold requires appointment_id before commit';
    END IF;

    IF NEW."appointment_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "appointments" appointment
        WHERE appointment."id" = NEW."appointment_id"
          AND appointment."slot_id" = NEW."slot_id"
    ) THEN
        RAISE EXCEPTION 'slot hold appointment does not belong to held slot';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "appointment_slot_holds_commit_consistency_trg"
AFTER INSERT OR UPDATE OF "status", "appointment_id", "slot_id" ON "appointment_slot_holds"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_slot_hold_commit"();

CREATE OR REPLACE FUNCTION "validate_payment_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "appointments" appointment
        WHERE appointment."id" = NEW."appointment_id"
          AND appointment."patient_id" = NEW."patient_id"
    ) THEN
        RAISE EXCEPTION 'payment patient does not match appointment patient';
    END IF;

    IF NEW."reschedule_request_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "appointment_reschedule_requests" request
        WHERE request."id" = NEW."reschedule_request_id"
          AND request."appointment_id" = NEW."appointment_id"
    ) THEN
        RAISE EXCEPTION 'payment reschedule request does not belong to appointment';
    END IF;

    IF NEW."parent_payment_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "payments" parent
        WHERE parent."id" = NEW."parent_payment_id"
          AND parent."appointment_id" = NEW."appointment_id"
          AND parent."patient_id" = NEW."patient_id"
          AND parent."status" = 'successful'
    ) THEN
        RAISE EXCEPTION 'parent payment must be successful and belong to the same appointment and patient';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_consistency_trg"
BEFORE INSERT OR UPDATE OF "appointment_id", "patient_id", "reschedule_request_id", "parent_payment_id", "status"
ON "payments"
FOR EACH ROW EXECUTE FUNCTION "validate_payment_consistency"();

CREATE OR REPLACE FUNCTION "validate_refund_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    paid_amount bigint;
    already_refunded bigint;
BEGIN
    SELECT payment."amount_minor"
    INTO paid_amount
    FROM "payments" payment
    WHERE payment."id" = NEW."payment_id"
      AND payment."appointment_id" = NEW."appointment_id"
      AND payment."status" = 'successful';

    IF paid_amount IS NULL THEN
        RAISE EXCEPTION 'refund payment must be successful and belong to appointment';
    END IF;

    SELECT COALESCE(SUM(refund."amount_minor"), 0)
    INTO already_refunded
    FROM "refunds" refund
    WHERE refund."payment_id" = NEW."payment_id"
      AND refund."id" <> NEW."id"
      AND refund."status" IN ('approved', 'processing', 'processed');

    IF already_refunded + NEW."amount_minor" > paid_amount THEN
        RAISE EXCEPTION 'refund total exceeds successful payment amount';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "refunds_consistency_trg"
BEFORE INSERT OR UPDATE OF "payment_id", "appointment_id", "amount_minor", "status"
ON "refunds"
FOR EACH ROW EXECUTE FUNCTION "validate_refund_consistency"();

CREATE OR REPLACE FUNCTION "validate_review_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "appointments" appointment
        WHERE appointment."id" = NEW."appointment_id"
          AND appointment."patient_id" = NEW."patient_id"
          AND appointment."doctor_id" = NEW."doctor_id"
          AND appointment."clinic_id" = NEW."clinic_id"
          AND appointment."status" = 'completed'
    ) THEN
        RAISE EXCEPTION 'review requires completed appointment and matching ownership';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "reviews_consistency_trg"
BEFORE INSERT OR UPDATE OF "appointment_id", "patient_id", "doctor_id", "clinic_id"
ON "reviews"
FOR EACH ROW EXECUTE FUNCTION "validate_review_consistency"();
