import { expect, test } from "@playwright/test";
import { apiUrl, e2eConfig, hasBookingFixture, hasPatientCredentials } from "./support/env.js";
import {
  authHeaders,
  getAvailableSlots,
  getPatientProfile,
  loginPatient
} from "./support/api.js";

test.describe("critical patient booking journey", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true to run staging/production E2E checks");
  test.skip(!e2eConfig.mutating, "Set E2E_MUTATING=true to run mutating booking E2E checks");
  test.skip(!hasPatientCredentials(), "Set E2E_PATIENT_EMAIL and E2E_PATIENT_PASSWORD");
  test.skip(!hasBookingFixture(), "Set E2E_DOCTOR_ID and E2E_SERVICE_ID");

  test("patient can book the first available slot and retrieve appointment status", async ({
    request
  }) => {
    const session = await loginPatient(request);
    const profile = await getPatientProfile(request, session.accessToken);
    const { availability } = await getAvailableSlots(request);
    const slot = availability[0];

    if (!slot) {
      test.skip(true, `No available slot found for ${e2eConfig.bookingDate}`);
      return;
    }

    const paymentPreference =
      slot.paymentMode === "online_required" ? "online" : "pay_at_clinic";
    const idempotencyKey = `e2e-booking-${crypto.randomUUID()}`;
    const bookingResponse = await request.post(apiUrl("/v1/patient/appointments"), {
      headers: {
        ...authHeaders(session.accessToken),
        "Idempotency-Key": idempotencyKey
      },
      data: {
        appointmentSlotId: slot.slotId,
        attendingPatientId: profile.patient.id,
        reasonForVisit: "E2E booking validation",
        bookingNotes: "Created by automated staging E2E",
        paymentPreference
      }
    });

    expect(bookingResponse.ok()).toBeTruthy();

    const booking = await bookingResponse.json();

    expect(booking).toEqual(
      expect.objectContaining({
        appointmentId: expect.any(String),
        appointmentNumber: expect.any(String),
        status: expect.stringMatching(/^(confirmed|pending_payment)$/u),
        idempotentReplay: false
      })
    );

    const replayResponse = await request.post(apiUrl("/v1/patient/appointments"), {
      headers: {
        ...authHeaders(session.accessToken),
        "Idempotency-Key": idempotencyKey
      },
      data: {
        appointmentSlotId: slot.slotId,
        attendingPatientId: profile.patient.id,
        reasonForVisit: "E2E booking validation",
        bookingNotes: "Created by automated staging E2E",
        paymentPreference
      }
    });

    expect(replayResponse.ok()).toBeTruthy();
    expect(await replayResponse.json()).toEqual(
      expect.objectContaining({
        appointmentId: booking.appointmentId,
        idempotentReplay: true
      })
    );

    const appointmentResponse = await request.get(
      apiUrl(`/v1/patient/appointments/${booking.appointmentId}`),
      {
        headers: authHeaders(session.accessToken)
      }
    );

    expect(appointmentResponse.ok()).toBeTruthy();
    expect(await appointmentResponse.json()).toEqual(
      expect.objectContaining({
        appointment: expect.objectContaining({
          id: booking.appointmentId,
          status: booking.status,
          doctorName: expect.any(String),
          clinicName: expect.any(String),
          feeMinor: expect.any(String),
          currency: slot.currency
        })
      })
    );

    if (booking.status === "pending_payment") {
      const paymentResponse = await request.get(
        apiUrl(`/v1/patient/appointments/${booking.appointmentId}/payment`),
        {
          headers: authHeaders(session.accessToken)
        }
      );

      expect(paymentResponse.ok()).toBeTruthy();
      expect(await paymentResponse.json()).toEqual(
        expect.objectContaining({
          appointmentId: booking.appointmentId,
          payment: expect.objectContaining({
            amountMinor: expect.any(String),
            currency: slot.currency
          })
        })
      );
    }
  });
});
