ALTER TABLE "notification_logs"
    ADD COLUMN "provider_status" VARCHAR(120),
    ADD COLUMN "provider_response" JSONB,
    ADD COLUMN "failure_classification" VARCHAR(40);

CREATE INDEX "notification_logs_provider_status_idx"
    ON "notification_logs" ("provider", "provider_status");

CREATE INDEX "notification_logs_failure_classification_idx"
    ON "notification_logs" ("failure_classification")
    WHERE "failure_classification" IS NOT NULL;
