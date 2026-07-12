export type E2EConfig = {
  enabled: boolean;
  mutating: boolean;
  providerNegative: boolean;
  webBaseUrl: string;
  apiBaseUrl: string;
  trustedOrigin: string;
  ignoreHttpsErrors: boolean;
  patientEmail: string | null;
  patientPassword: string | null;
  doctorId: string | null;
  serviceId: string | null;
  onlineDoctorId: string | null;
  onlineServiceId: string | null;
  payhereMerchantId: string | null;
  payhereMerchantSecret: string | null;
  payhereWebhookSuccess: boolean;
  databaseUrl: string | null;
  bookingDate: string;
  onlineBookingDate: string;
};

export const e2eConfig: E2EConfig = {
  enabled: process.env.E2E_RUN === "true",
  mutating: process.env.E2E_MUTATING === "true",
  providerNegative: process.env.E2E_PROVIDER_NEGATIVE === "true",
  webBaseUrl: trimTrailingSlash(process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000"),
  apiBaseUrl: trimTrailingSlash(process.env.E2E_API_URL ?? "http://127.0.0.1:4000"),
  trustedOrigin: trimTrailingSlash(
    process.env.E2E_TRUSTED_ORIGIN ??
      process.env.E2E_BASE_URL ??
      "http://127.0.0.1:3000"
  ),
  ignoreHttpsErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === "true",
  patientEmail: optionalEnv("E2E_PATIENT_EMAIL"),
  patientPassword: optionalEnv("E2E_PATIENT_PASSWORD"),
  doctorId: optionalEnv("E2E_DOCTOR_ID"),
  serviceId: optionalEnv("E2E_SERVICE_ID"),
  onlineDoctorId: optionalEnv("E2E_ONLINE_DOCTOR_ID") ?? optionalEnv("E2E_DOCTOR_ID"),
  onlineServiceId: optionalEnv("E2E_ONLINE_SERVICE_ID"),
  payhereMerchantId: optionalEnv("E2E_PAYHERE_MERCHANT_ID"),
  payhereMerchantSecret: optionalEnv("E2E_PAYHERE_MERCHANT_SECRET"),
  payhereWebhookSuccess: process.env.E2E_PAYHERE_WEBHOOK_SUCCESS === "true",
  databaseUrl: optionalEnv("E2E_DATABASE_URL"),
  bookingDate: process.env.E2E_BOOKING_DATE ?? nextWeekdayYmd(),
  onlineBookingDate:
    process.env.E2E_ONLINE_BOOKING_DATE ?? process.env.E2E_BOOKING_DATE ?? nextWeekdayYmd()
};

export function apiUrl(path: string) {
  return `${e2eConfig.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function hasPatientCredentials() {
  return Boolean(e2eConfig.patientEmail && e2eConfig.patientPassword);
}

export function hasBookingFixture() {
  return Boolean(e2eConfig.doctorId && e2eConfig.serviceId);
}

export function hasOnlinePaymentFixture() {
  return Boolean(e2eConfig.onlineDoctorId && e2eConfig.onlineServiceId);
}

function optionalEnv(key: string) {
  const value = process.env[key]?.trim();

  return value ? value : null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function nextWeekdayYmd() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);

  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString().slice(0, 10);
}
