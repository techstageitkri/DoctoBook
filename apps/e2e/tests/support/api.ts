import { APIRequestContext, expect } from "@playwright/test";
import { apiUrl, e2eConfig } from "./env.js";

export type AuthSession = {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string | null;
    fullName: string;
    roles: string[];
  };
};

export type PatientProfile = {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

export type AvailabilitySlot = {
  slotId: string;
  doctorClinicServiceId: string;
  startsAt: string;
  endsAt: string;
  doctorId: string;
  serviceId: string;
  paymentMode: "online_required" | "pay_at_clinic" | "online_optional";
  feeMinor: string;
  currency: string;
};

export type AvailabilityQuery = {
  doctorId?: string | null;
  serviceId?: string | null;
  bookingDate?: string;
};

export async function loginPatient(request: APIRequestContext) {
  if (!e2eConfig.patientEmail || !e2eConfig.patientPassword) {
    throw new Error("E2E_PATIENT_EMAIL and E2E_PATIENT_PASSWORD are required");
  }

  const response = await request.post(apiUrl("/v1/auth/login"), {
    headers: {
      Origin: e2eConfig.trustedOrigin
    },
    data: {
      email: e2eConfig.patientEmail,
      password: e2eConfig.patientPassword,
      deviceName: "DoctoBook E2E"
    }
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as AuthSession;
}

export async function getPatientProfile(request: APIRequestContext, accessToken: string) {
  const response = await request.get(apiUrl("/v1/patient/me"), {
    headers: authHeaders(accessToken)
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { patient: PatientProfile };
}

export async function getAvailableSlots(request: APIRequestContext, query: AvailabilityQuery = {}) {
  const doctorId = query.doctorId ?? e2eConfig.doctorId;
  const serviceId = query.serviceId ?? e2eConfig.serviceId;
  const bookingDate = query.bookingDate ?? e2eConfig.bookingDate;

  if (!doctorId || !serviceId) {
    throw new Error("E2E_DOCTOR_ID and E2E_SERVICE_ID are required");
  }

  const params = new URLSearchParams({
    doctorId,
    serviceId,
    fromDate: bookingDate,
    toDate: bookingDate,
    limit: "10"
  });
  const response = await request.get(apiUrl(`/v1/public/availability?${params.toString()}`));

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { availability: AvailabilitySlot[] };
}

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Origin: e2eConfig.trustedOrigin
  };
}

export function setCookieHeader(headers: Record<string, string>) {
  return headers["set-cookie"] ?? headers["Set-Cookie"] ?? "";
}
