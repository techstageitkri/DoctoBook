import { describe, expect, it } from "vitest";
import {
  buildPatientAuthPayload,
  canCancelRescheduleRequest,
  canPatientCancel,
  canPatientReschedule,
  canPatientReview,
  patientNavigationRoutes,
  summarizePatientAppointments
} from "./patient-domain";

describe("patient portal navigation and forms", () => {
  it("uses focused routes without hash navigation", () => {
    expect(patientNavigationRoutes).toHaveLength(6);
    expect(patientNavigationRoutes.every((route) => route.startsWith("/patient") && !route.includes("#"))).toBe(true);
  });

  it("normalizes patient authentication payloads without token fields", () => {
    const payload = buildPatientAuthPayload("register", {
      fullName: "  Ayesha Perera  ",
      email: "  PATIENT@EXAMPLE.COM ",
      password: "Password123!"
    });
    expect(payload).toMatchObject({ accountType: "patient", fullName: "Ayesha Perera", email: "patient@example.com" });
    expect(payload).not.toHaveProperty("accessToken");
    expect(payload).not.toHaveProperty("refreshToken");
  });
});

describe("patient appointment workflows", () => {
  it("preserves cancel, reschedule, review, and pending-reschedule rules", () => {
    expect(canPatientCancel({ status: "confirmed" })).toBe(true);
    expect(canPatientReschedule({ status: "pending_payment" })).toBe(true);
    expect(canPatientReview({ status: "completed" })).toBe(true);
    expect(canPatientCancel({ status: "completed" })).toBe(false);
    expect(canCancelRescheduleRequest({ status: "pending_payment" })).toBe(true);
    expect(canCancelRescheduleRequest({ status: "completed" })).toBe(false);
  });

  it("summarizes upcoming care, pending payments, and reviews due", () => {
    const now = Date.parse("2026-07-12T00:00:00.000Z");
    const summary = summarizePatientAppointments([
      { status: "confirmed", startsAt: "2026-07-13T09:00:00.000Z", payment: { status: "successful" }, review: null },
      { status: "pending_payment", startsAt: "2026-07-14T09:00:00.000Z", payment: { status: "pending" }, review: null },
      { status: "completed", startsAt: "2026-07-01T09:00:00.000Z", payment: null, review: null }
    ], now);
    expect(summary).toEqual({ upcoming: 2, pendingPayments: 1, reviewsDue: 1 });
  });
});
