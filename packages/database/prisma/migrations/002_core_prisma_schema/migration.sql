-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('pending_verification', 'pending_approval', 'active', 'inactive', 'suspended', 'deactivated');

-- CreateEnum
CREATE TYPE "clinic_status" AS ENUM ('draft', 'pending_approval', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "doctor_status" AS ENUM ('pending_approval', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "clinic_association_status" AS ENUM ('pending', 'approved', 'rejected', 'removed');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('pending_payment', 'confirmed', 'checked_in', 'waiting', 'in_progress', 'completed', 'cancelled_by_patient', 'cancelled_by_clinic', 'cancelled_by_admin', 'no_show', 'expired');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('patient_web', 'doctor_portal', 'receptionist_portal', 'admin_dashboard', 'mobile_app', 'imported');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('online_required', 'pay_at_clinic', 'online_optional');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('initiated', 'pending', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'under_review', 'approved', 'rejected', 'processing', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('pending_moderation', 'approved', 'rejected', 'hidden');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'push');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'processing', 'sent', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "permission_effect" AS ENUM ('grant', 'deny');

-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('platform', 'clinic', 'clinic_location', 'doctor', 'patient', 'appointment');

-- CreateEnum
CREATE TYPE "file_visibility" AS ENUM ('private', 'protected', 'public');

-- CreateEnum
CREATE TYPE "document_review_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "slot_hold_status" AS ENUM ('active', 'converted', 'expired', 'released', 'cancelled');

-- CreateEnum
CREATE TYPE "reschedule_request_status" AS ENUM ('requested', 'approved', 'rejected', 'applied', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('appointment', 'reschedule_difference');

-- CreateEnum
CREATE TYPE "provider_type" AS ENUM ('payment', 'email', 'sms', 'push', 'storage');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "phone" VARCHAR(32),
    "password_hash" TEXT,
    "full_name" VARCHAR(160) NOT NULL,
    "avatar_file_id" UUID,
    "status" "user_status" NOT NULL DEFAULT 'pending_verification',
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "preferred_locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_id" VARCHAR(120),
    "device_name" VARCHAR(160),
    "ip_address" INET,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "token_hash" TEXT NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "email" CITEXT,
    "phone" VARCHAR(32),
    "metadata" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "module" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_permission_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "permission_effect" NOT NULL DEFAULT 'grant',
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID,
    "granted_by_user_id" UUID,
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" UUID NOT NULL,
    "uploaded_by_user_id" UUID,
    "storage_provider" VARCHAR(80) NOT NULL,
    "bucket" VARCHAR(160),
    "object_key" TEXT NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(160),
    "visibility" "file_visibility" NOT NULL DEFAULT 'private',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(40),
    "address_line1" VARCHAR(180),
    "address_line2" VARCHAR(180),
    "city" VARCHAR(100),
    "district" VARCHAR(100),
    "country" VARCHAR(2) NOT NULL DEFAULT 'LK',
    "emergency_contact_name" VARCHAR(160),
    "emergency_contact_phone" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_dependents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "relationship" VARCHAR(80) NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(40),
    "phone" VARCHAR(32),
    "consent_confirmed_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_dependents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "logo_file_id" UUID,
    "status" "clinic_status" NOT NULL DEFAULT 'draft',
    "email" CITEXT,
    "phone" VARCHAR(32),
    "website_url" TEXT,
    "default_payment_mode" "payment_mode",
    "cancellation_window_minutes" INTEGER,
    "refund_processing_days" INTEGER,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_locations" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" VARCHAR(160),
    "address" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100),
    "province" VARCHAR(100),
    "country" VARCHAR(2) NOT NULL DEFAULT 'LK',
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Colombo',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "phone" VARCHAR(32),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "clinic_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clinic_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_location_hours" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "opens_at" TIME(0),
    "closes_at" TIME(0),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clinic_location_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_location_closures" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_location_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_admins" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "clinic_association_status" NOT NULL DEFAULT 'approved',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receptionists" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "clinic_location_id" UUID,
    "user_id" UUID NOT NULL,
    "status" "clinic_association_status" NOT NULL DEFAULT 'approved',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receptionists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "license_number" VARCHAR(120),
    "status" "doctor_status" NOT NULL DEFAULT 'pending_approval',
    "bio" TEXT,
    "qualifications" TEXT,
    "years_experience" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profile_file_id" UUID,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_documents" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "document_type" VARCHAR(80) NOT NULL,
    "platform_status" "document_review_status" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_document_clinic_reviews" (
    "id" UUID NOT NULL,
    "doctor_document_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "status" "document_review_status" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_document_clinic_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" UUID NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_specialties" (
    "doctor_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_specialties_pkey" PRIMARY KEY ("doctor_id","specialty_id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "default_duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_services" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "display_name" VARCHAR(160),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clinic_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_clinics" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "clinic_location_id" UUID NOT NULL,
    "status" "clinic_association_status" NOT NULL DEFAULT 'pending',
    "default_consultation_fee_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "payment_mode" "payment_mode",
    "default_slot_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "doctor_clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_clinic_services" (
    "id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "clinic_service_id" UUID NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "fee_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "payment_mode" "payment_mode",
    "cancellation_window_minutes" INTEGER,
    "reschedule_window_minutes" INTEGER,
    "max_reschedules" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "doctor_clinic_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_availability_rules" (
    "id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "starts_at" TIME(0) NOT NULL,
    "ends_at" TIME(0) NOT NULL,
    "slot_interval_minutes" INTEGER,
    "max_patients" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "doctor_availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_availability_breaks" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "starts_at" TIME(0) NOT NULL,
    "ends_at" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_availability_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_time_off" (
    "id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "doctor_clinic_service_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_slots" (
    "id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "doctor_clinic_service_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointment_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_slot_holds" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appointment_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "status" "slot_hold_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointment_slot_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "appointment_number" VARCHAR(40) NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "clinic_location_id" UUID NOT NULL,
    "doctor_clinic_id" UUID NOT NULL,
    "doctor_clinic_service_id" UUID NOT NULL,
    "slot_id" UUID,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "manual_override_reason" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'confirmed',
    "source" "appointment_source" NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "service_name_snapshot" VARCHAR(180) NOT NULL,
    "service_duration_minutes" INTEGER NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "attending_patient_id" UUID,
    "attending_dependent_id" UUID,
    "attending_name_snapshot" VARCHAR(180) NOT NULL,
    "attending_relationship" VARCHAR(80),
    "reason_for_visit" TEXT,
    "booking_notes" TEXT,
    "internal_notes" TEXT,
    "queue_date" DATE,
    "queue_number" INTEGER,
    "checked_in_at" TIMESTAMPTZ(6),
    "consultation_started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "cancellation_reason" TEXT,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "from_status" "appointment_status",
    "to_status" "appointment_status" NOT NULL,
    "changed_by_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reschedule_requests" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "old_slot_id" UUID,
    "new_slot_id" UUID,
    "old_doctor_clinic_service_id" UUID NOT NULL,
    "new_doctor_clinic_service_id" UUID NOT NULL,
    "old_starts_at" TIMESTAMPTZ(6) NOT NULL,
    "old_ends_at" TIMESTAMPTZ(6) NOT NULL,
    "new_starts_at" TIMESTAMPTZ(6) NOT NULL,
    "new_ends_at" TIMESTAMPTZ(6) NOT NULL,
    "old_fee_minor" BIGINT NOT NULL,
    "new_fee_minor" BIGINT NOT NULL,
    "difference_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "status" "reschedule_request_status" NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointment_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "provider_payment_id" VARCHAR(160),
    "idempotency_key" VARCHAR(160),
    "payment_purpose" "payment_purpose" NOT NULL DEFAULT 'appointment',
    "parent_payment_id" UUID,
    "reschedule_request_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "status" "payment_status" NOT NULL DEFAULT 'initiated',
    "payment_method" VARCHAR(80),
    "gateway_response" JSONB,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "provider_event_id" VARCHAR(160),
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID,
    "provider" VARCHAR(80) NOT NULL,
    "provider_refund_id" VARCHAR(160),
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "reason" TEXT NOT NULL,
    "admin_notes" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_status_history" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "from_status" "payment_status",
    "to_status" "payment_status" NOT NULL,
    "webhook_event_id" UUID,
    "actor_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_status_history" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "from_status" "refund_status",
    "to_status" "refund_status" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(160),
    "comment" TEXT,
    "status" "review_status" NOT NULL DEFAULT 'pending_moderation',
    "moderator_user_id" UUID,
    "moderated_at" TIMESTAMPTZ(6),
    "moderation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_rating_summaries" (
    "doctor_id" UUID NOT NULL,
    "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "doctor_rating_summaries_pkey" PRIMARY KEY ("doctor_id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID,
    "event_code" VARCHAR(120) NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "appointment_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "event_code" VARCHAR(120) NOT NULL,
    "idempotency_key" VARCHAR(160),
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "provider" VARCHAR(80),
    "provider_message_id" VARCHAR(160),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(40) NOT NULL,
    "device_id" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID,
    "key" VARCHAR(160) NOT NULL,
    "value" JSONB NOT NULL,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configurations" (
    "id" UUID NOT NULL,
    "provider_type" "provider_type" NOT NULL,
    "provider_code" VARCHAR(80) NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID,
    "display_name" VARCHAR(160) NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" VARCHAR(80),
    "action_code" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(120) NOT NULL,
    "entity_id" UUID,
    "clinic_id" UUID,
    "patient_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "correlation_id" VARCHAR(160),
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" VARCHAR(120) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(120) NOT NULL,
    "entity_id" UUID,
    "field_name" VARCHAR(120) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_avatar_file_id_idx" ON "users"("avatar_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_created_at_idx" ON "verification_tokens"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_permission_grants_user_id_permission_id_scope_type_sco_idx" ON "user_permission_grants"("user_id", "permission_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "user_permission_grants_scope_type_scope_id_idx" ON "user_permission_grants"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "user_permission_grants_expires_at_idx" ON "user_permission_grants"("expires_at");

-- CreateIndex
CREATE INDEX "uploaded_files_uploaded_by_user_id_idx" ON "uploaded_files"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "uploaded_files_object_key_idx" ON "uploaded_files"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patient_dependents_patient_id_is_active_idx" ON "patient_dependents"("patient_id", "is_active");

-- CreateIndex
CREATE INDEX "clinics_status_idx" ON "clinics"("status");

-- CreateIndex
CREATE INDEX "clinics_slug_idx" ON "clinics"("slug");

-- CreateIndex
CREATE INDEX "clinics_created_by_user_id_idx" ON "clinics"("created_by_user_id");

-- CreateIndex
CREATE INDEX "clinic_locations_clinic_id_status_idx" ON "clinic_locations"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "clinic_locations_city_district_idx" ON "clinic_locations"("city", "district");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_locations_id_clinic_id_key" ON "clinic_locations"("id", "clinic_id");

-- CreateIndex
CREATE INDEX "clinic_location_hours_location_id_day_of_week_idx" ON "clinic_location_hours"("location_id", "day_of_week");

-- CreateIndex
CREATE INDEX "clinic_location_closures_location_id_starts_at_ends_at_idx" ON "clinic_location_closures"("location_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "clinic_admins_user_id_status_idx" ON "clinic_admins"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_admins_clinic_id_user_id_key" ON "clinic_admins"("clinic_id", "user_id");

-- CreateIndex
CREATE INDEX "receptionists_clinic_location_id_idx" ON "receptionists"("clinic_location_id");

-- CreateIndex
CREATE INDEX "receptionists_user_id_status_idx" ON "receptionists"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receptionists_clinic_id_user_id_key" ON "receptionists"("clinic_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE INDEX "doctors_status_idx" ON "doctors"("status");

-- CreateIndex
CREATE INDEX "doctors_slug_idx" ON "doctors"("slug");

-- CreateIndex
CREATE INDEX "doctor_documents_doctor_id_document_type_idx" ON "doctor_documents"("doctor_id", "document_type");

-- CreateIndex
CREATE INDEX "doctor_documents_platform_status_idx" ON "doctor_documents"("platform_status");

-- CreateIndex
CREATE INDEX "doctor_document_clinic_reviews_clinic_id_status_idx" ON "doctor_document_clinic_reviews"("clinic_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_document_clinic_reviews_doctor_document_id_doctor_cl_key" ON "doctor_document_clinic_reviews"("doctor_document_id", "doctor_clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_slug_key" ON "specialties"("slug");

-- CreateIndex
CREATE INDEX "specialties_parent_id_idx" ON "specialties"("parent_id");

-- CreateIndex
CREATE INDEX "specialties_is_active_idx" ON "specialties"("is_active");

-- CreateIndex
CREATE INDEX "doctor_specialties_specialty_id_idx" ON "doctor_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_is_active_idx" ON "services"("is_active");

-- CreateIndex
CREATE INDEX "clinic_services_service_id_idx" ON "clinic_services"("service_id");

-- CreateIndex
CREATE INDEX "clinic_services_clinic_id_is_active_idx" ON "clinic_services"("clinic_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_services_clinic_id_service_id_key" ON "clinic_services"("clinic_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_services_id_clinic_id_service_id_key" ON "clinic_services"("id", "clinic_id", "service_id");

-- CreateIndex
CREATE INDEX "doctor_clinics_doctor_id_status_idx" ON "doctor_clinics"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "doctor_clinics_clinic_id_status_idx" ON "doctor_clinics"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "doctor_clinics_clinic_location_id_idx" ON "doctor_clinics"("clinic_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_clinics_id_doctor_id_clinic_id_clinic_location_id_key" ON "doctor_clinics"("id", "doctor_id", "clinic_id", "clinic_location_id");

-- CreateIndex
CREATE INDEX "doctor_clinic_services_doctor_clinic_id_is_active_idx" ON "doctor_clinic_services"("doctor_clinic_id", "is_active");

-- CreateIndex
CREATE INDEX "doctor_clinic_services_clinic_service_id_idx" ON "doctor_clinic_services"("clinic_service_id");

-- CreateIndex
CREATE INDEX "doctor_availability_rules_doctor_clinic_id_day_of_week_is_a_idx" ON "doctor_availability_rules"("doctor_clinic_id", "day_of_week", "is_active");

-- CreateIndex
CREATE INDEX "doctor_availability_breaks_rule_id_idx" ON "doctor_availability_breaks"("rule_id");

-- CreateIndex
CREATE INDEX "doctor_time_off_doctor_clinic_id_starts_at_ends_at_idx" ON "doctor_time_off"("doctor_clinic_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "doctor_time_off_doctor_clinic_service_id_idx" ON "doctor_time_off"("doctor_clinic_service_id");

-- CreateIndex
CREATE INDEX "appointment_slots_doctor_clinic_service_id_starts_at_idx" ON "appointment_slots"("doctor_clinic_service_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_slots_starts_at_is_active_idx" ON "appointment_slots"("starts_at", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_slots_doctor_clinic_id_doctor_clinic_service_id_key" ON "appointment_slots"("doctor_clinic_id", "doctor_clinic_service_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_slot_holds_idempotency_key_key" ON "appointment_slot_holds"("idempotency_key");

-- CreateIndex
CREATE INDEX "appointment_slot_holds_slot_id_status_expires_at_idx" ON "appointment_slot_holds"("slot_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "appointment_slot_holds_user_id_status_idx" ON "appointment_slot_holds"("user_id", "status");

-- CreateIndex
CREATE INDEX "appointment_slot_holds_appointment_id_idx" ON "appointment_slot_holds"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_appointment_number_key" ON "appointments"("appointment_number");

-- CreateIndex
CREATE INDEX "appointments_patient_id_starts_at_idx" ON "appointments"("patient_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_doctor_id_starts_at_idx" ON "appointments"("doctor_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_doctor_clinic_id_starts_at_idx" ON "appointments"("doctor_clinic_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_starts_at_idx" ON "appointments"("clinic_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_clinic_location_id_queue_date_queue_number_idx" ON "appointments"("clinic_location_id", "queue_date", "queue_number");

-- CreateIndex
CREATE INDEX "appointments_slot_id_idx" ON "appointments"("slot_id");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_created_at_idx" ON "appointment_status_history"("appointment_id", "created_at");

-- CreateIndex
CREATE INDEX "appointment_reschedule_requests_appointment_id_created_at_idx" ON "appointment_reschedule_requests"("appointment_id", "created_at");

-- CreateIndex
CREATE INDEX "appointment_reschedule_requests_status_created_at_idx" ON "appointment_reschedule_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_appointment_id_idx" ON "payments"("appointment_id");

-- CreateIndex
CREATE INDEX "payments_patient_id_created_at_idx" ON "payments"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_provider_payment_id_idx" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processed_at_idx" ON "payment_webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_provider_event_id_key" ON "payment_webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_appointment_id_idx" ON "refunds"("appointment_id");

-- CreateIndex
CREATE INDEX "refunds_status_requested_at_idx" ON "refunds"("status", "requested_at");

-- CreateIndex
CREATE INDEX "refunds_provider_provider_refund_id_idx" ON "refunds"("provider", "provider_refund_id");

-- CreateIndex
CREATE INDEX "payment_status_history_payment_id_created_at_idx" ON "payment_status_history"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_status_history_refund_id_created_at_idx" ON "refund_status_history"("refund_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "reviews"("appointment_id");

-- CreateIndex
CREATE INDEX "reviews_doctor_id_status_idx" ON "reviews"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "reviews_clinic_id_status_idx" ON "reviews"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "reviews_patient_id_idx" ON "reviews"("patient_id");

-- CreateIndex
CREATE INDEX "notification_templates_event_code_channel_idx" ON "notification_templates"("event_code", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_scope_type_scope_id_event_code_chann_key" ON "notification_templates"("scope_type", "scope_id", "event_code", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_idempotency_key_key" ON "notification_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_appointment_id_idx" ON "notification_logs"("appointment_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_scheduled_at_idx" ON "notification_logs"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_push_tokens_token_key" ON "user_push_tokens"("token");

-- CreateIndex
CREATE INDEX "user_push_tokens_user_id_is_active_idx" ON "user_push_tokens"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "system_settings_scope_type_scope_id_idx" ON "system_settings"("scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_scope_type_scope_id_key_key" ON "system_settings"("scope_type", "scope_id", "key");

-- CreateIndex
CREATE INDEX "provider_configurations_provider_type_is_active_idx" ON "provider_configurations"("provider_type", "is_active");

-- CreateIndex
CREATE INDEX "provider_configurations_scope_type_scope_id_idx" ON "provider_configurations"("scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configurations_provider_type_provider_code_scope_t_key" ON "provider_configurations"("provider_type", "provider_code", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_clinic_id_created_at_idx" ON "audit_logs"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_patient_id_created_at_idx" ON "audit_logs"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_code_created_at_idx" ON "audit_logs"("action_code", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_user_id_consent_type_recorded_at_idx" ON "consent_records"("user_id", "consent_type", "recorded_at");

-- CreateIndex
CREATE INDEX "translations_locale_idx" ON "translations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "translations_entity_type_entity_id_field_name_locale_key" ON "translations"("entity_type", "entity_id", "field_name", "locale");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_fkey" FOREIGN KEY ("avatar_file_id") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_grants" ADD CONSTRAINT "user_permission_grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_grants" ADD CONSTRAINT "user_permission_grants_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_grants" ADD CONSTRAINT "user_permission_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_dependents" ADD CONSTRAINT "patient_dependents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_locations" ADD CONSTRAINT "clinic_locations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_location_hours" ADD CONSTRAINT "clinic_location_hours_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "clinic_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_location_closures" ADD CONSTRAINT "clinic_location_closures_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_location_closures" ADD CONSTRAINT "clinic_location_closures_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "clinic_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_admins" ADD CONSTRAINT "clinic_admins_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_admins" ADD CONSTRAINT "clinic_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionists" ADD CONSTRAINT "receptionists_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionists" ADD CONSTRAINT "receptionists_clinic_location_id_fkey" FOREIGN KEY ("clinic_location_id") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionists" ADD CONSTRAINT "receptionists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_profile_file_id_fkey" FOREIGN KEY ("profile_file_id") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document_clinic_reviews" ADD CONSTRAINT "doctor_document_clinic_reviews_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document_clinic_reviews" ADD CONSTRAINT "doctor_document_clinic_reviews_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document_clinic_reviews" ADD CONSTRAINT "doctor_document_clinic_reviews_doctor_document_id_fkey" FOREIGN KEY ("doctor_document_id") REFERENCES "doctor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document_clinic_reviews" ADD CONSTRAINT "doctor_document_clinic_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_services" ADD CONSTRAINT "clinic_services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_services" ADD CONSTRAINT "clinic_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_clinic_location_id_fkey" FOREIGN KEY ("clinic_location_id") REFERENCES "clinic_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_services" ADD CONSTRAINT "doctor_clinic_services_clinic_service_id_fkey" FOREIGN KEY ("clinic_service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_services" ADD CONSTRAINT "doctor_clinic_services_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability_rules" ADD CONSTRAINT "doctor_availability_rules_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability_breaks" ADD CONSTRAINT "doctor_availability_breaks_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "doctor_availability_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_clinic_service_id_fkey" FOREIGN KEY ("doctor_clinic_service_id") REFERENCES "doctor_clinic_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_doctor_clinic_service_id_fkey" FOREIGN KEY ("doctor_clinic_service_id") REFERENCES "doctor_clinic_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "appointment_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_attending_dependent_id_fkey" FOREIGN KEY ("attending_dependent_id") REFERENCES "patient_dependents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_location_id_fkey" FOREIGN KEY ("clinic_location_id") REFERENCES "clinic_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_clinic_id_fkey" FOREIGN KEY ("doctor_clinic_id") REFERENCES "doctor_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_clinic_service_id_fkey" FOREIGN KEY ("doctor_clinic_service_id") REFERENCES "doctor_clinic_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "appointment_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_new_doctor_clinic_service__fkey" FOREIGN KEY ("new_doctor_clinic_service_id") REFERENCES "doctor_clinic_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_new_slot_id_fkey" FOREIGN KEY ("new_slot_id") REFERENCES "appointment_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_old_doctor_clinic_service__fkey" FOREIGN KEY ("old_doctor_clinic_service_id") REFERENCES "doctor_clinic_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_old_slot_id_fkey" FOREIGN KEY ("old_slot_id") REFERENCES "appointment_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedule_requests" ADD CONSTRAINT "appointment_reschedule_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_payment_id_fkey" FOREIGN KEY ("parent_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reschedule_request_id_fkey" FOREIGN KEY ("reschedule_request_id") REFERENCES "appointment_reschedule_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "payment_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_status_history" ADD CONSTRAINT "refund_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_status_history" ADD CONSTRAINT "refund_status_history_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderator_user_id_fkey" FOREIGN KEY ("moderator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_rating_summaries" ADD CONSTRAINT "doctor_rating_summaries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
