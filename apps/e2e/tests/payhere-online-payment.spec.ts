import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  apiUrl,
  e2eConfig,
  hasOnlinePaymentFixture,
  hasPatientCredentials
} from "./support/env.js";
import {
  authHeaders,
  getAvailableSlots,
  getPatientProfile,
  loginPatient
} from "./support/api.js";
import { getOnlinePaymentDbSnapshot } from "./support/db.js";

type PaymentStatusResponse = {
  appointmentId: string;
  appointmentStatus: string;
  payment: {
    paymentId: string;
    status: string;
    provider: string;
    providerPaymentId: string | null;
    amountMinor: string;
    currency: string;
    checkoutUrl: string | null;
    checkoutFields: Record<string, string> | null;
    expiresAt: string | null;
    reconciliationRequired: boolean;
  } | null;
};

test.describe("PayHere online payment journey", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true to run staging/production E2E checks");
  test.skip(!e2eConfig.mutating, "Set E2E_MUTATING=true to run mutating booking E2E checks");
  test.skip(!hasPatientCredentials(), "Set E2E_PATIENT_EMAIL and E2E_PATIENT_PASSWORD");
  test.skip(!hasOnlinePaymentFixture(), "Set E2E_ONLINE_SERVICE_ID");
  test.skip(!e2eConfig.payhereMerchantId, "Set E2E_PAYHERE_MERCHANT_ID");

  test("online-required booking creates PayHere checkout metadata without browser-return confirmation", async ({
    request
  }) => {
    const { session, profile, slot, booking } = await createOnlineBooking(request);

    expect(booking).toEqual(
      expect.objectContaining({
        appointmentId: expect.any(String),
        appointmentNumber: expect.any(String),
        status: "pending_payment",
        idempotentReplay: false,
        payment: expect.objectContaining({
          paymentId: expect.any(String),
          status: "initiated",
          amountMinor: slot.feeMinor,
          currency: "LKR",
          redirectPending: true
        })
      })
    );

    const paymentStatus = await waitForPayHereCheckout(
      request,
      session.accessToken,
      booking.appointmentId
    );

    assertCheckoutMetadata(paymentStatus, {
      appointmentId: booking.appointmentId,
      patientId: profile.patient.id,
      paymentId: booking.payment.paymentId,
      amountMinor: slot.feeMinor
    });

    const dbSnapshot = await getOnlinePaymentDbSnapshot(booking.appointmentId);
    if (dbSnapshot) {
      expect(dbSnapshot).toEqual(
        expect.objectContaining({
          appointmentStatus: "pending_payment",
          paymentStatus: "pending",
          provider: "payhere",
          paymentId: booking.payment.paymentId,
          activeHoldCount: expect.any(Number),
          pendingAppointmentHistoryCount: expect.any(Number),
          pendingPaymentHistoryCount: expect.any(Number)
        })
      );
      expect(dbSnapshot.activeHoldCount).toBeGreaterThanOrEqual(1);
      expect(dbSnapshot.pendingAppointmentHistoryCount).toBeGreaterThanOrEqual(1);
      expect(dbSnapshot.pendingPaymentHistoryCount).toBeGreaterThanOrEqual(1);
    }

    await assertBrowserPaymentPageDoesNotConfirm(request, session.accessToken, booking.appointmentId);
  });

  test("signed PayHere success webhook confirms appointment once", async ({ request }) => {
    test.skip(
      !e2eConfig.payhereWebhookSuccess,
      "Set E2E_PAYHERE_WEBHOOK_SUCCESS=true to run signed webhook success checks"
    );
    test.skip(!e2eConfig.payhereMerchantSecret, "Set E2E_PAYHERE_MERCHANT_SECRET");

    const { session, profile, slot, booking } = await createOnlineBooking(request);
    const paymentStatus = await waitForPayHereCheckout(
      request,
      session.accessToken,
      booking.appointmentId
    );
    const checkoutFields = paymentStatus.payment?.checkoutFields;

    expect(checkoutFields).toBeTruthy();
    expect(checkoutFields?.amount).toEqual(expect.any(String));
    const checkoutAmount = checkoutFields?.amount;

    if (!checkoutAmount) {
      throw new Error("PayHere checkout amount is missing");
    }

    const successPayload = createPayHereSuccessPayload({
      merchantId: e2eConfig.payhereMerchantId!,
      merchantSecret: e2eConfig.payhereMerchantSecret!,
      appointmentId: booking.appointmentId,
      patientId: profile.patient.id,
      paymentId: booking.payment.paymentId,
      providerPaymentId: `e2e-${crypto.randomUUID()}`,
      amount: checkoutAmount,
      currency: slot.currency
    });

    const successResponse = await request.post(apiUrl("/v1/payments/webhooks/payhere"), {
      headers: {
        "Content-Type": "application/json"
      },
      data: successPayload
    });

    expect(successResponse.ok()).toBeTruthy();
    expect(await successResponse.json()).toEqual(
      expect.objectContaining({
        received: true,
        processed: true,
        status: "successful"
      })
    );

    const confirmedStatus = await waitForPaymentStatus(
      request,
      session.accessToken,
      booking.appointmentId,
      (status) =>
        status.appointmentStatus === "confirmed" &&
        status.payment?.status === "successful" &&
        status.payment.providerPaymentId === successPayload.payment_id
    );

    expect(confirmedStatus.payment).toEqual(
      expect.objectContaining({
        paymentId: booking.payment.paymentId,
        status: "successful",
        provider: "payhere",
        providerPaymentId: successPayload.payment_id,
        amountMinor: slot.feeMinor,
        currency: slot.currency
      })
    );

    const firstDbSnapshot = await getOnlinePaymentDbSnapshot(booking.appointmentId);
    if (firstDbSnapshot) {
      expect(firstDbSnapshot).toEqual(
        expect.objectContaining({
          appointmentStatus: "confirmed",
          paymentStatus: "successful",
          provider: "payhere",
          activeHoldCount: 0,
          convertedHoldCount: expect.any(Number),
          confirmedAppointmentHistoryCount: expect.any(Number),
          successfulPaymentHistoryCount: expect.any(Number)
        })
      );
      expect(firstDbSnapshot.convertedHoldCount).toBeGreaterThanOrEqual(1);
      expect(firstDbSnapshot.confirmedAppointmentHistoryCount).toBeGreaterThanOrEqual(1);
      expect(firstDbSnapshot.successfulPaymentHistoryCount).toBeGreaterThanOrEqual(1);
    }

    const duplicateResponse = await request.post(apiUrl("/v1/payments/webhooks/payhere"), {
      headers: {
        "Content-Type": "application/json"
      },
      data: successPayload
    });

    expect(duplicateResponse.ok()).toBeTruthy();
    expect(await duplicateResponse.json()).toEqual(
      expect.objectContaining({
        received: true,
        processed: false,
        duplicate: true
      })
    );

    const duplicateDbSnapshot = await getOnlinePaymentDbSnapshot(booking.appointmentId);
    if (firstDbSnapshot && duplicateDbSnapshot) {
      expect(duplicateDbSnapshot.confirmedAppointmentHistoryCount).toBe(
        firstDbSnapshot.confirmedAppointmentHistoryCount
      );
      expect(duplicateDbSnapshot.successfulPaymentHistoryCount).toBe(
        firstDbSnapshot.successfulPaymentHistoryCount
      );
    }

    expect(profile.patient.id).toBe(successPayload.custom_2);
  });
});

async function createOnlineBooking(request: Parameters<typeof loginPatient>[0]) {
  const session = await loginPatient(request);
  const profile = await getPatientProfile(request, session.accessToken);
  const { availability } = await getAvailableSlots(request, {
    doctorId: e2eConfig.onlineDoctorId,
    serviceId: e2eConfig.onlineServiceId,
    bookingDate: e2eConfig.onlineBookingDate
  });
  const slot = availability.find((candidate) => candidate.paymentMode === "online_required");

  if (!slot) {
    test.skip(true, `No online-required slot found for ${e2eConfig.onlineBookingDate}`);
    throw new Error("No online-required slot found");
  }

  expect(slot.currency).toBe("LKR");
  expect(Number(slot.feeMinor)).toBeGreaterThan(0);

  const idempotencyKey = `e2e-payhere-${crypto.randomUUID()}`;
  const payload = {
    appointmentSlotId: slot.slotId,
    attendingPatientId: profile.patient.id,
    reasonForVisit: "E2E PayHere online booking validation",
    bookingNotes: "Created by automated staging PayHere E2E",
    paymentPreference: "online"
  };
  const bookingResponse = await request.post(apiUrl("/v1/patient/appointments"), {
    headers: {
      ...authHeaders(session.accessToken),
      "Idempotency-Key": idempotencyKey
    },
    data: payload
  });

  expect(bookingResponse.ok()).toBeTruthy();

  const booking = (await bookingResponse.json()) as {
    appointmentId: string;
    appointmentNumber: string;
    status: string;
    idempotentReplay: boolean;
    payment: {
      paymentId: string;
      status: string;
      amountMinor: string;
      currency: string;
      redirectPending: boolean;
    };
  };

  const replayResponse = await request.post(apiUrl("/v1/patient/appointments"), {
    headers: {
      ...authHeaders(session.accessToken),
      "Idempotency-Key": idempotencyKey
    },
    data: payload
  });

  expect(replayResponse.ok()).toBeTruthy();
  expect(await replayResponse.json()).toEqual(
    expect.objectContaining({
      appointmentId: booking.appointmentId,
      idempotentReplay: true
    })
  );

  return { session, profile, slot, booking };
}

async function waitForPayHereCheckout(
  request: Parameters<typeof loginPatient>[0],
  accessToken: string,
  appointmentId: string
) {
  return waitForPaymentStatus(
    request,
    accessToken,
    appointmentId,
    (status) =>
      status.appointmentStatus === "pending_payment" &&
      status.payment?.status === "pending" &&
      status.payment.provider === "payhere" &&
      Boolean(status.payment.checkoutUrl) &&
      Boolean(status.payment.checkoutFields)
  );
}

async function waitForPaymentStatus(
  request: Parameters<typeof loginPatient>[0],
  accessToken: string,
  appointmentId: string,
  predicate: (status: PaymentStatusResponse) => boolean
) {
  let lastStatus: PaymentStatusResponse | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(apiUrl(`/v1/patient/appointments/${appointmentId}/payment`), {
      headers: authHeaders(accessToken)
    });

    expect(response.ok()).toBeTruthy();
    lastStatus = (await response.json()) as PaymentStatusResponse;

    if (predicate(lastStatus)) {
      return lastStatus;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Payment status did not reach expected state: ${JSON.stringify(lastStatus)}`);
}

function assertCheckoutMetadata(
  status: PaymentStatusResponse,
  expected: {
    appointmentId: string;
    patientId: string;
    paymentId: string;
    amountMinor: string;
  }
) {
  const payment = status.payment;
  const fields = payment?.checkoutFields;

  expect(status.appointmentId).toBe(expected.appointmentId);
  expect(status.appointmentStatus).toBe("pending_payment");
  expect(payment).toEqual(
    expect.objectContaining({
      paymentId: expected.paymentId,
      status: "pending",
      provider: "payhere",
      providerPaymentId: null,
      amountMinor: expected.amountMinor,
      currency: "LKR",
      checkoutUrl: expect.stringContaining("payhere.lk/pay/checkout"),
      expiresAt: expect.any(String),
      reconciliationRequired: false
    })
  );
  expect(fields).toEqual(
    expect.objectContaining({
      merchant_id: e2eConfig.payhereMerchantId,
      return_url: `${e2eConfig.webBaseUrl}/patient/payments/return`,
      cancel_url: `${e2eConfig.webBaseUrl}/patient/payments/cancel`,
      notify_url: `${e2eConfig.apiBaseUrl}/v1/payments/webhooks/payhere`,
      order_id: expected.paymentId,
      currency: "LKR",
      custom_1: expected.appointmentId,
      custom_2: expected.patientId,
      phone: expect.any(String),
      address: expect.any(String),
      city: expect.any(String),
      country: expect.any(String),
      hash: expect.any(String)
    })
  );
  expect(fields?.amount).toBe(formatMinorAmount(expected.amountMinor));
  expect(fields?.items).toEqual(expect.any(String));
  expect(fields?.first_name).toEqual(expect.any(String));
  expect(fields?.email).toContain("@");
}

async function assertBrowserPaymentPageDoesNotConfirm(
  request: Parameters<typeof loginPatient>[0],
  accessToken: string,
  appointmentId: string
) {
  for (const path of ["/patient/payments/return", "/patient/payments/cancel"]) {
    const response = await request.get(
      `${e2eConfig.webBaseUrl}${path}?order_id=${appointmentId}&status_code=2`
    );

    expect(response.status()).toBeLessThan(500);
  }

  const status = await waitForPaymentStatus(
    request,
    accessToken,
    appointmentId,
    (candidate) =>
      candidate.appointmentStatus === "pending_payment" &&
      candidate.payment?.status === "pending" &&
      candidate.payment.providerPaymentId === null
  );

  expect(status.payment?.status).not.toBe("successful");
}

function createPayHereSuccessPayload(input: {
  merchantId: string;
  merchantSecret: string;
  appointmentId: string;
  patientId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
}) {
  const statusCode = "2";

  return {
    merchant_id: input.merchantId,
    order_id: input.paymentId,
    payment_id: input.providerPaymentId,
    status_code: statusCode,
    payhere_amount: input.amount,
    payhere_currency: input.currency,
    method: "VISA",
    custom_1: input.appointmentId,
    custom_2: input.patientId,
    md5sig: md5Upper(
      `${input.merchantId}${input.paymentId}${input.amount}${input.currency}${statusCode}${md5Upper(
        input.merchantSecret
      )}`
    )
  };
}

function formatMinorAmount(amountMinor: string) {
  const amount = BigInt(amountMinor);
  const whole = amount / 100n;
  const cents = amount % 100n;

  return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

function md5Upper(value: string) {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}
