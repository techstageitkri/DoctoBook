ALTER TABLE "appointments"
    ADD COLUMN "booking_idempotency_key" VARCHAR(120),
    ADD COLUMN "booking_request_hash" VARCHAR(64);

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_booking_idempotency_hash_chk"
    CHECK (
        ("booking_idempotency_key" IS NULL AND "booking_request_hash" IS NULL)
        OR ("booking_idempotency_key" IS NOT NULL AND "booking_request_hash" IS NOT NULL)
    );

CREATE UNIQUE INDEX "uq_appointments_booking_idempotency"
    ON "appointments" ("patient_id", "booking_idempotency_key")
    WHERE "booking_idempotency_key" IS NOT NULL;

CREATE INDEX "appointments_patient_booking_idempotency_key_idx"
    ON "appointments" ("patient_id", "booking_idempotency_key");
