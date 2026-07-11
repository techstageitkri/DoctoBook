ALTER TYPE "refund_status" ADD VALUE IF NOT EXISTS 'reconciliation_required';

ALTER TABLE "refunds"
    ADD COLUMN "provider_status" VARCHAR(120),
    ADD COLUMN "provider_response" JSONB,
    ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reconciliation_reason" TEXT,
    ADD COLUMN "reconciliation_notes" TEXT,
    ADD COLUMN "reconciliation_assigned_to_user_id" UUID,
    ADD COLUMN "last_verification_at" TIMESTAMPTZ(6),
    ADD COLUMN "resolved_at" TIMESTAMPTZ(6),
    ADD COLUMN "resolution_action" VARCHAR(80);

ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_reconciliation_assigned_to_user_id_fkey"
    FOREIGN KEY ("reconciliation_assigned_to_user_id")
    REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "refunds_retry_count_idx"
    ON "refunds" ("retry_count");

CREATE INDEX "refunds_reconciliation_assigned_idx"
    ON "refunds" ("reconciliation_assigned_to_user_id")
    WHERE "reconciliation_assigned_to_user_id" IS NOT NULL;
