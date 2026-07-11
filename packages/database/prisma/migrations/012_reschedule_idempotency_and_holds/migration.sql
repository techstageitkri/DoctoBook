ALTER TABLE "appointment_slot_holds"
    ADD COLUMN "reschedule_request_id" uuid;

ALTER TABLE "appointment_reschedule_requests"
    ADD COLUMN "reschedule_idempotency_key" VARCHAR(120),
    ADD COLUMN "reschedule_request_hash" VARCHAR(64);

ALTER TABLE "appointment_slot_holds"
    ADD CONSTRAINT "appointment_slot_holds_reschedule_request_id_fkey"
    FOREIGN KEY ("reschedule_request_id")
    REFERENCES "appointment_reschedule_requests"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "appointment_reschedule_requests"
    ADD CONSTRAINT "appointment_reschedule_requests_idempotency_hash_chk"
    CHECK (
        ("reschedule_idempotency_key" IS NULL AND "reschedule_request_hash" IS NULL)
        OR ("reschedule_idempotency_key" IS NOT NULL AND "reschedule_request_hash" IS NOT NULL)
    );

CREATE UNIQUE INDEX "uq_reschedule_requests_idempotency"
    ON "appointment_reschedule_requests" ("appointment_id", "reschedule_idempotency_key")
    WHERE "reschedule_idempotency_key" IS NOT NULL;

CREATE INDEX "appointment_slot_holds_reschedule_request_id_idx"
    ON "appointment_slot_holds" ("reschedule_request_id");

CREATE INDEX "appointment_reschedule_requests_idempotency_idx"
    ON "appointment_reschedule_requests" ("appointment_id", "reschedule_idempotency_key");

DROP TRIGGER IF EXISTS "appointment_slot_holds_commit_consistency_trg" ON "appointment_slot_holds";
DROP FUNCTION IF EXISTS "validate_slot_hold_commit"();

CREATE OR REPLACE FUNCTION "validate_slot_hold_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" IN ('active', 'converted')
       AND NEW."appointment_id" IS NULL
       AND NEW."reschedule_request_id" IS NULL THEN
        RAISE EXCEPTION 'active or converted slot hold requires appointment_id or reschedule_request_id before commit';
    END IF;

    IF NEW."appointment_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "appointments" appointment
        WHERE appointment."id" = NEW."appointment_id"
          AND appointment."slot_id" = NEW."slot_id"
    ) THEN
        RAISE EXCEPTION 'slot hold appointment does not belong to held slot';
    END IF;

    IF NEW."reschedule_request_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "appointment_reschedule_requests" request
        WHERE request."id" = NEW."reschedule_request_id"
          AND request."new_slot_id" = NEW."slot_id"
    ) THEN
        RAISE EXCEPTION 'slot hold reschedule request does not belong to held slot';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "appointment_slot_holds_commit_consistency_trg"
AFTER INSERT OR UPDATE OF "status", "appointment_id", "reschedule_request_id", "slot_id" ON "appointment_slot_holds"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_slot_hold_commit"();
