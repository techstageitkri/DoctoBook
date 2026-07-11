import { randomUUID } from "node:crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentStatus,
  SlotHoldStatus,
  UserStatus
} from "@doctobook/database";
import {
  createPayHereNotificationSignature,
  initiateStoredPayment,
  parseGatewayResponse
} from "@doctobook/payments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service.js";
import { PaymentService } from "../src/payments/payment.service.js";

process.env.NODE_ENV ??= "test";

const runDatabaseTests =
  process.env.RUN_API_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const merchantId = "1220000";
const merchantSecret = "payhere-test-secret";
const testDate = "2036-01-09";

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describeDatabase("payment webhooks", () => {
  let prisma: PrismaService;
  let payments: PaymentService;

  beforeAll(async () => {
    process.env.PAYHERE_MERCHANT_ID = merchantId;
    process.env.PAYHERE_MERCHANT_SECRET = merchantSecret;
    prisma = new PrismaService();
    await prisma.$connect();
    payments = new PaymentService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("successful PayHere webhook confirms the appointment and converts the hold", async () => {
    const fixture = await createPaymentFixture("success");
    const payload = createPayHerePayload(fixture, "2");

    const result = await payments.processWebhook("payhere", payload, {});
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const hold = await prisma.appointmentSlotHold.findUniqueOrThrow({
      where: { id: fixture.holdId }
    });
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });

    expect(result).toEqual(
      expect.objectContaining({
        received: true,
        processed: true,
        status: "successful"
      })
    );
    expect(payment.status).toBe(PaymentStatus.SUCCESSFUL);
    expect(payment.provider).toBe("payhere");
    expect(payment.providerPaymentId).toBe(payload.payment_id);
    expect(payment.paidAt).toBeInstanceOf(Date);
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(hold.status).toBe(SlotHoldStatus.CONVERTED);
    expect(hold.resolvedAt).toBeInstanceOf(Date);
  });

  it("duplicate successful webhook is idempotent and does not duplicate histories", async () => {
    const fixture = await createPaymentFixture("duplicate-success");
    const payload = createPayHerePayload(fixture, "2");

    await payments.processWebhook("payhere", payload, {});
    const duplicateResult = await payments.processWebhook("payhere", payload, {});
    const paymentHistoryCount = await prisma.paymentStatusHistory.count({
      where: { paymentId: fixture.paymentId }
    });
    const appointmentHistoryCount = await prisma.appointmentStatusHistory.count({
      where: { appointmentId: fixture.appointmentId, toStatus: AppointmentStatus.CONFIRMED }
    });

    expect(duplicateResult).toEqual(
      expect.objectContaining({
        processed: false,
        duplicate: true
      })
    );
    expect(paymentHistoryCount).toBe(1);
    expect(appointmentHistoryCount).toBe(1);
  });

  it("rejects invalid PayHere signatures and stores the invalid webhook attempt", async () => {
    const fixture = await createPaymentFixture("invalid-signature");
    const payload = {
      ...createPayHerePayload(fixture, "2"),
      md5sig: "INVALID"
    };

    await expect(payments.processWebhook("payhere", payload, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PAYMENT_WEBHOOK_INVALID_SIGNATURE" })
    });

    const invalidEvent = await prisma.paymentWebhookEvent.findFirst({
      where: {
        provider: "payhere",
        signatureValid: false,
        error: "PAYMENT_WEBHOOK_INVALID_SIGNATURE"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(invalidEvent).toEqual(expect.objectContaining({ processedAt: expect.any(Date) }));
  });

  it("rejects amount mismatches without confirming the appointment", async () => {
    const fixture = await createPaymentFixture("amount-mismatch");
    const payload = createPayHerePayload(fixture, "2", { payhere_amount: "1.00" });

    const result = await payments.processWebhook("payhere", payload, {});
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });

    expect(result).toEqual(
      expect.objectContaining({
        rejected: true,
        code: "PAYMENT_AMOUNT_MISMATCH"
      })
    );
    expect(payment.status).toBe(PaymentStatus.INITIATED);
    expect(appointment.status).toBe(AppointmentStatus.PENDING_PAYMENT);
  });

  it("rejects currency mismatches without confirming the appointment", async () => {
    const fixture = await createPaymentFixture("currency-mismatch");
    const payload = createPayHerePayload(fixture, "2", { payhere_currency: "USD" });

    const result = await payments.processWebhook("payhere", payload, {});
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });

    expect(result).toEqual(
      expect.objectContaining({
        rejected: true,
        code: "PAYMENT_CURRENCY_MISMATCH"
      })
    );
    expect(payment.status).toBe(PaymentStatus.INITIATED);
  });

  it("marks reconciliation required when success arrives after appointment expiration", async () => {
    const fixture = await createPaymentFixture("expired-reconciliation");

    await prisma.appointmentSlotHold.update({
      where: { id: fixture.holdId },
      data: {
        status: SlotHoldStatus.EXPIRED,
        resolvedAt: new Date()
      }
    });
    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: {
        status: AppointmentStatus.EXPIRED
      }
    });

    await payments.processWebhook("payhere", createPayHerePayload(fixture, "2"), {});
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });
    const gateway = parseGatewayResponse(payment.gatewayResponse);

    expect(payment.status).toBe(PaymentStatus.SUCCESSFUL);
    expect(appointment.status).toBe(AppointmentStatus.EXPIRED);
    expect(gateway?.reconciliationRequired).toBe(true);
  });

  it("does not downgrade a successful payment when a later failure webhook arrives", async () => {
    const fixture = await createPaymentFixture("success-then-failed");

    await payments.processWebhook("payhere", createPayHerePayload(fixture, "2"), {});
    await payments.processWebhook(
      "payhere",
      createPayHerePayload(fixture, "-2", { payment_id: `payhere-failed-${randomUUID()}` }),
      {}
    );

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId }
    });

    expect(payment.status).toBe(PaymentStatus.SUCCESSFUL);
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("payment initiation retry reuses the same provider order", async () => {
    const fixture = await createPaymentFixture("initiation-retry");
    const env = {
      ...process.env,
      PAYMENT_PROVIDER: "payhere",
      PAYHERE_MERCHANT_ID: merchantId,
      PAYHERE_MERCHANT_SECRET: merchantSecret,
      PAYHERE_CHECKOUT_URL: "https://sandbox.payhere.lk/pay/checkout"
    };

    const first = await initiateStoredPayment(prisma, fixture.paymentId, env);
    const second = await initiateStoredPayment(prisma, fixture.paymentId, env);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: fixture.paymentId }
    });
    const historyCount = await prisma.paymentStatusHistory.count({
      where: { paymentId: fixture.paymentId }
    });

    expect(second.providerOrderId).toBe(first.providerOrderId);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(historyCount).toBe(1);
  });

  async function createPaymentFixture(prefix: string) {
    const patientUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-patient`),
        fullName: "Payment Test Patient",
        status: UserStatus.ACTIVE
      }
    });
    const patient = await prisma.patient.create({
      data: { userId: patientUser.id }
    });
    const doctorUser = await prisma.user.create({
      data: {
        email: uniqueEmail(`${prefix}-doctor`),
        fullName: "Payment Test Doctor",
        status: UserStatus.ACTIVE
      }
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        slug: uniqueSlug(`${prefix}-doctor`),
        licenseNumber: `SLMC-${randomUUID()}`,
        status: DoctorStatus.APPROVED
      }
    });
    const clinic = await prisma.clinic.create({
      data: {
        name: "Payment Test Clinic",
        slug: uniqueSlug(`${prefix}-clinic`),
        status: ClinicStatus.ACTIVE,
        defaultPaymentMode: PaymentMode.ONLINE_REQUIRED
      }
    });
    const clinicLocation = await prisma.clinicLocation.create({
      data: {
        clinicId: clinic.id,
        address: "10 Payment Street",
        city: "Colombo",
        timezone: "Asia/Colombo",
        status: ClinicStatus.ACTIVE
      }
    });
    const service = await prisma.service.create({
      data: {
        name: `Payment Consultation ${prefix}`,
        slug: uniqueSlug(`${prefix}-service`),
        defaultDurationMinutes: 30,
        isActive: true
      }
    });
    const clinicService = await prisma.clinicService.create({
      data: {
        clinicId: clinic.id,
        serviceId: service.id,
        isActive: true
      }
    });
    const doctorClinic = await prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        status: ClinicAssociationStatus.APPROVED,
        defaultConsultationFeeMinor: 250000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        defaultSlotIntervalMinutes: 15
      }
    });
    const doctorClinicService = await prisma.doctorClinicService.create({
      data: {
        doctorClinicId: doctorClinic.id,
        clinicServiceId: clinicService.id,
        durationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        isActive: true
      }
    });
    const startsAt = colomboUtc(testDate, "09:00");
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const slot = await prisma.appointmentSlot.create({
      data: {
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        startsAt,
        endsAt,
        isActive: true
      }
    });
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber: `APT-${randomUUID()}`,
        patientId: patient.id,
        doctorId: doctor.id,
        clinicId: clinic.id,
        clinicLocationId: clinicLocation.id,
        doctorClinicId: doctorClinic.id,
        doctorClinicServiceId: doctorClinicService.id,
        slotId: slot.id,
        startsAt,
        endsAt,
        status: AppointmentStatus.PENDING_PAYMENT,
        source: AppointmentSource.PATIENT_WEB,
        paymentMode: PaymentMode.ONLINE_REQUIRED,
        serviceNameSnapshot: service.name,
        serviceDurationMinutes: 30,
        feeMinor: 250000n,
        currency: "LKR",
        attendingPatientId: patient.id,
        attendingNameSnapshot: patientUser.fullName,
        createdByUserId: patientUser.id
      }
    });
    const hold = await prisma.appointmentSlotHold.create({
      data: {
        slotId: slot.id,
        userId: patientUser.id,
        appointmentId: appointment.id,
        idempotencyKey: `hold-${randomUUID()}`,
        status: SlotHoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });
    const payment = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        provider: "pending_gateway",
        idempotencyKey: `payment-${randomUUID()}`,
        amountMinor: 250000n,
        currency: "LKR",
        status: PaymentStatus.INITIATED
      }
    });

    return {
      appointmentId: appointment.id,
      holdId: hold.id,
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency
    };
  }
});

function createPayHerePayload(
  fixture: { paymentId: string; amountMinor: bigint; currency: string },
  statusCode: string,
  overrides: Partial<Record<string, string>> = {}
) {
  const payhereAmount = overrides.payhere_amount ?? formatMinorAmount(fixture.amountMinor);
  const payhereCurrency = overrides.payhere_currency ?? fixture.currency;
  const paymentId = overrides.payment_id ?? `payhere-${randomUUID()}`;
  const payload = {
    merchant_id: merchantId,
    order_id: fixture.paymentId,
    payment_id: paymentId,
    payhere_amount: payhereAmount,
    payhere_currency: payhereCurrency,
    status_code: statusCode,
    method: "VISA"
  };

  return {
    ...payload,
    md5sig: createPayHereNotificationSignature({
      merchantId,
      orderId: payload.order_id,
      payhereAmount: payload.payhere_amount,
      currency: payload.payhere_currency,
      statusCode: payload.status_code,
      merchantSecret
    })
  };
}

function formatMinorAmount(amountMinor: bigint) {
  const major = amountMinor / 100n;
  const minor = amountMinor % 100n;

  return `${major.toString()}.${minor.toString().padStart(2, "0")}`;
}

function colomboUtc(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;

  return new Date(`${date}T${normalized}+05:30`);
}
