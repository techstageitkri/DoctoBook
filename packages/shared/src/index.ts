export const APP_NAME = "DoctoBook";

export const ACTIVE_APPOINTMENT_STATUSES = [
  "pending_payment",
  "confirmed",
  "checked_in",
  "waiting",
  "in_progress"
] as const;

export const SUPPORTED_LOCALES = ["en"] as const;

export type ActiveAppointmentStatus = (typeof ACTIVE_APPOINTMENT_STATUSES)[number];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
