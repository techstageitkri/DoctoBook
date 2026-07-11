import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AppointmentStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RefundStatus,
  RescheduleRequestStatus,
  SlotHoldStatus
} from "@doctobook/database";

export const PAYMENT_INITIATION_QUEUE_NAME = "payment-initiation";
export const PAYMENT_INITIATE_JOB = "payment.initiate";
export const REFUND_PROCESSING_QUEUE_NAME = "refund-processing";
export const REFUND_PROCESS_JOB = "refund.process";

export type InitiatePaymentJob = {
  paymentId: string;
  appointmentId: string;
};

export type ProcessRefundJob = {
  refundId: string;
};

export type InitiatePaymentInput = {
  paymentId: string;
  appointmentId: string;
  patientId: string;
  amountMinor: bigint;
  currency: string;
  patientName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  description: string;
  expiresAt?: Date | null;
};

export type InitiatePaymentResult = {
  provider: string;
  providerOrderId: string;
  providerPaymentId?: string | null;
  providerStatus: string;
  checkoutUrl?: string | null;
  checkoutFields?: Record<string, string>;
  expiresAt?: Date | null;
  providerMetadata?: Record<string, unknown>;
};

export type VerifyWebhookInput = {
  payload: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

export type CreateRefundInput = {
  refundId: string;
  paymentId: string;
  appointmentId: string;
  providerPaymentId?: string | null;
  amountMinor: bigint;
  currency: string;
  reason: string;
};

export type CreateRefundResult = {
  provider: string;
  providerRefundId: string;
  providerStatus: string;
  processedAt?: Date | null;
  providerMetadata?: Record<string, unknown>;
};

export type VerifiedWebhookEvent = {
  provider: string;
  providerEventId: string;
  providerPaymentId?: string | null;
  internalPaymentId: string;
  status: PaymentStatus;
  amountMinor: bigint;
  currency: string;
  rawStatus: string;
  paymentMethod?: string | null;
  paidAt?: Date | null;
  payload: Record<string, unknown>;
};

export type PaymentProvider = {
  name: string;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent>;
  createRefund(input: CreateRefundInput): Promise<CreateRefundResult>;
  getRefundStatus?(providerRefundId: string): Promise<RefundStatus>;
};

export type PaymentProviderName = "mock" | "payhere";

const processableRefundStatuses: RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED
];

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly safeMetadata: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function createPaymentProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const provider = (env.PAYMENT_PROVIDER ?? "mock").toLowerCase();

  if (provider === "payhere") {
    return new PayHerePaymentProvider({
      merchantId: requireEnv(env, "PAYHERE_MERCHANT_ID"),
      merchantSecret: requireEnv(env, "PAYHERE_MERCHANT_SECRET"),
      checkoutUrl: env.PAYHERE_CHECKOUT_URL ?? "https://sandbox.payhere.lk/pay/checkout",
      returnUrl: env.PAYMENT_RETURN_URL ?? "http://localhost:3000/patient/payments/return",
      cancelUrl: env.PAYMENT_CANCEL_URL ?? "http://localhost:3000/patient/payments/cancel",
      notifyUrl:
        env.PAYHERE_NOTIFY_URL ?? "http://localhost:4000/v1/payments/webhooks/payhere",
      defaultPhone: env.PAYHERE_DEFAULT_PHONE ?? "0771234567",
      defaultAddress: env.PAYHERE_DEFAULT_ADDRESS ?? "N/A",
      defaultCity: env.PAYHERE_DEFAULT_CITY ?? "Colombo",
      defaultCountry: env.PAYHERE_DEFAULT_COUNTRY ?? "Sri Lanka"
    });
  }

  if (provider !== "mock") {
    throw new PaymentProviderError("Unsupported payment provider", "PAYMENT_PROVIDER_UNSUPPORTED", 500, {
      provider
    });
  }

  return new MockPaymentProvider({
    publicBaseUrl: env.PAYMENT_PUBLIC_BASE_URL ?? "http://localhost:3000",
    webhookSecret: env.MOCK_PAYMENT_WEBHOOK_SECRET ?? "development-mock-payment-secret"
  });
}

export async function initiateStoredPayment(
  prisma: PrismaClient,
  paymentId: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const provider = createPaymentProviderFromEnv(env);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "payments"
      WHERE "id" = CAST(${paymentId} AS uuid)
      FOR UPDATE
    `;

    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            patient: {
              include: {
                user: {
                  select: {
                    fullName: true,
                    email: true,
                    phone: true
                  }
                }
              }
            },
            holds: {
              where: { status: SlotHoldStatus.ACTIVE },
              orderBy: { expiresAt: "desc" },
              take: 1
            }
          }
        },
        rescheduleRequest: {
          include: {
            holds: {
              where: { status: SlotHoldStatus.ACTIVE },
              orderBy: { expiresAt: "desc" },
              take: 1
            }
          }
        }
      }
    });

    if (!payment) {
      throw new PaymentProviderError("Payment not found", "PAYMENT_NOT_FOUND", 404);
    }

    if (payment.status === PaymentStatus.SUCCESSFUL) {
      return getStoredInitiationResult(payment.gatewayResponse, payment.provider, payment.id);
    }

    if (
      payment.status !== PaymentStatus.INITIATED &&
      payment.status !== PaymentStatus.PENDING
    ) {
      throw new PaymentProviderError("Payment cannot be initiated", "PAYMENT_NOT_INITIABLE", 409, {
        paymentId: payment.id,
        status: payment.status
      });
    }

    if (
      payment.paymentPurpose !== PaymentPurpose.RESCHEDULE_DIFFERENCE &&
      payment.appointment.status !== AppointmentStatus.PENDING_PAYMENT
    ) {
      throw new PaymentProviderError("Appointment is not pending payment", "APPOINTMENT_NOT_PAYABLE", 409, {
        appointmentId: payment.appointmentId,
        status: payment.appointment.status
      });
    }

    if (
      payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE &&
      payment.rescheduleRequest?.status !== RescheduleRequestStatus.REQUESTED
    ) {
      throw new PaymentProviderError("Reschedule request is not payable", "RESCHEDULE_NOT_PAYABLE", 409, {
        paymentId: payment.id,
        rescheduleRequestId: payment.rescheduleRequestId,
        status: payment.rescheduleRequest?.status
      });
    }

    const existingGateway = parseGatewayResponse(payment.gatewayResponse);

    if (
      existingGateway?.provider === provider.name &&
      existingGateway.providerOrderId &&
      existingGateway.checkoutUrl
    ) {
      return {
        provider: existingGateway.provider,
        providerOrderId: existingGateway.providerOrderId,
        providerPaymentId: payment.providerPaymentId,
        providerStatus: existingGateway.providerStatus ?? payment.status.toLowerCase(),
        checkoutUrl: existingGateway.checkoutUrl,
        checkoutFields: existingGateway.checkoutFields,
        expiresAt: existingGateway.expiresAt ? new Date(existingGateway.expiresAt) : null,
        providerMetadata: existingGateway.providerMetadata
      } satisfies InitiatePaymentResult;
    }

    const initiation = await provider.initiatePayment({
      paymentId: payment.id,
      appointmentId: payment.appointmentId,
      patientId: payment.patientId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      patientName: payment.appointment.patient.user.fullName,
      patientEmail: payment.appointment.patient.user.email,
      patientPhone: payment.appointment.patient.user.phone,
      description:
        payment.paymentPurpose === PaymentPurpose.RESCHEDULE_DIFFERENCE
          ? `${payment.appointment.serviceNameSnapshot} reschedule difference`
          : payment.appointment.serviceNameSnapshot,
      expiresAt:
        payment.paymentPurpose === "RESCHEDULE_DIFFERENCE"
          ? payment.rescheduleRequest?.holds[0]?.expiresAt ?? null
          : payment.appointment.holds[0]?.expiresAt ?? null
    });
    const fromStatus = payment.status;
    const nextStatus =
      payment.status === PaymentStatus.INITIATED ? PaymentStatus.PENDING : payment.status;
    const gatewayResponse = toGatewayResponse(initiation);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        provider: initiation.provider,
        providerPaymentId: initiation.providerPaymentId ?? payment.providerPaymentId,
        status: nextStatus,
        gatewayResponse: gatewayResponse as Prisma.InputJsonValue
      }
    });

    if (fromStatus !== nextStatus) {
      await tx.paymentStatusHistory.create({
        data: {
          paymentId: payment.id,
          fromStatus,
          toStatus: nextStatus,
          reason: "Payment initiation sent to provider",
          metadata: gatewayResponse as Prisma.InputJsonValue
        }
      });
    }

    await tx.auditLog.create({
      data: {
        actionCode: "payment.initiated",
        entityType: "payment",
        entityId: payment.id,
        clinicId: payment.appointment.clinicId,
        patientId: payment.patientId,
        metadata: toJson({
          provider: initiation.provider,
          appointmentId: payment.appointmentId,
          providerOrderId: initiation.providerOrderId
        }) as Prisma.InputJsonValue
      }
    });

    return initiation;
  });
}

export async function processStoredRefund(
  prisma: PrismaClient,
  refundId: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const provider = createPaymentProviderFromEnv(env);
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "refunds"
      WHERE "id" = CAST(${refundId} AS uuid)
      FOR UPDATE
    `;

    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: true,
        appointment: true
      }
    });

    if (!refund) {
      throw new PaymentProviderError("Refund not found", "REFUND_NOT_FOUND", 404);
    }

    if (refund.status === RefundStatus.PROCESSED) {
      return {
        alreadyProcessed: true,
        refund,
        input: null
      };
    }

    if (!processableRefundStatuses.includes(refund.status)) {
      throw new PaymentProviderError("Refund cannot be processed", "REFUND_NOT_PROCESSABLE", 409, {
        refundId: refund.id,
        status: refund.status
      });
    }

    if (refund.payment.status !== PaymentStatus.SUCCESSFUL) {
      throw new PaymentProviderError("Refund payment is not successful", "REFUND_PAYMENT_INVALID", 409, {
        refundId: refund.id,
        paymentId: refund.paymentId
      });
    }

    const previousStatus = refund.status;
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        provider: provider.name,
        status: RefundStatus.PROCESSING
      }
    });
    await tx.refundStatusHistory.create({
      data: {
        refundId: refund.id,
        fromStatus: previousStatus,
        toStatus: RefundStatus.PROCESSING,
        reason: "Refund processing started",
        metadata: toJson({
          provider: provider.name,
          paymentId: refund.paymentId
        }) as Prisma.InputJsonValue
      }
    });

    return {
      alreadyProcessed: false,
      refund,
      input: {
        refundId: refund.id,
        paymentId: refund.paymentId,
        appointmentId: refund.appointmentId,
        providerPaymentId: refund.payment.providerPaymentId,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        reason: refund.reason
      } satisfies CreateRefundInput
    };
  });

  if (prepared.alreadyProcessed || !prepared.input) {
    return {
      processed: false,
      duplicate: true,
      status: "processed",
      refundId
    };
  }

  let result: CreateRefundResult;

  try {
    result = await provider.createRefund(prepared.input);
  } catch (error) {
    await markRefundFailed(prisma, refundId, error);
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "refunds"
      WHERE "id" = CAST(${refundId} AS uuid)
      FOR UPDATE
    `;
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId }
    });

    if (refund.status === RefundStatus.PROCESSED) {
      return;
    }

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        provider: result.provider,
        providerRefundId: result.providerRefundId,
        providerStatus: result.providerStatus,
        providerResponse: toJson({
          providerStatus: result.providerStatus,
          providerMetadata: result.providerMetadata ?? {}
        }) as Prisma.InputJsonValue,
        status: RefundStatus.PROCESSED,
        processedAt: result.processedAt ?? new Date(),
        resolvedAt: result.processedAt ?? new Date(),
        resolutionAction: "provider_processed",
        reconciliationReason: null,
        reconciliationNotes: null,
        reconciliationAssignedToUserId: null,
        lastVerificationAt: new Date(),
        adminNotes: JSON.stringify(
          toJson({
            providerStatus: result.providerStatus,
            providerMetadata: result.providerMetadata ?? {}
          })
        )
      }
    });
    await tx.refundStatusHistory.create({
      data: {
        refundId: refund.id,
        fromStatus: refund.status,
        toStatus: RefundStatus.PROCESSED,
        reason: "Provider refund processed",
        metadata: toJson({
          provider: result.provider,
          providerRefundId: result.providerRefundId,
          providerStatus: result.providerStatus,
          providerMetadata: result.providerMetadata ?? {}
        }) as Prisma.InputJsonValue
      }
    });
    await tx.auditLog.create({
      data: {
        actionCode: "refund.processed",
        entityType: "refund",
        entityId: refund.id,
        clinicId: prepared.refund.appointment.clinicId,
        patientId: prepared.refund.appointment.patientId,
        metadata: toJson({
          paymentId: refund.paymentId,
          provider: result.provider,
          providerRefundId: result.providerRefundId
        }) as Prisma.InputJsonValue
      }
    });
  });

  return {
    processed: true,
    duplicate: false,
    status: "processed",
    refundId,
    providerRefundId: result.providerRefundId
  };
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  constructor(private readonly config: { publicBaseUrl: string; webhookSecret: string }) {}

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return {
      provider: this.name,
      providerOrderId: input.paymentId,
      providerStatus: "pending",
      checkoutUrl: `${this.config.publicBaseUrl.replace(/\/$/, "")}/mock-payments/${input.paymentId}`,
      expiresAt: input.expiresAt ?? null,
      providerMetadata: {
        mode: "mock"
      }
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent> {
    const payload = asRecord(input.payload);
    const signature = getHeader(input.headers, "x-mock-payment-signature") ?? "";
    const expectedSignature = createMockWebhookSignature(payload, this.config.webhookSecret);

    if (!constantTimeEqual(signature, expectedSignature)) {
      throw new PaymentProviderError("Invalid payment webhook signature", "PAYMENT_WEBHOOK_INVALID_SIGNATURE", 401);
    }

    const paymentId = requireString(payload, "paymentId");
    const status = parseMockStatus(requireString(payload, "status"));
    const amountMinor = BigInt(requireString(payload, "amountMinor"));
    const currency = requireString(payload, "currency").toUpperCase();
    const providerPaymentId = getString(payload, "providerPaymentId") ?? `mock-${paymentId}`;
    const eventId = getString(payload, "eventId") ?? `mock|${paymentId}|${providerPaymentId}|${status}`;

    return {
      provider: this.name,
      providerEventId: eventId,
      providerPaymentId,
      internalPaymentId: paymentId,
      status,
      amountMinor,
      currency,
      rawStatus: requireString(payload, "status"),
      paymentMethod: getString(payload, "paymentMethod"),
      paidAt: status === PaymentStatus.SUCCESSFUL ? new Date() : null,
      payload
    };
  }

  async createRefund(input: CreateRefundInput): Promise<CreateRefundResult> {
    return {
      provider: this.name,
      providerRefundId: `mock-refund-${input.refundId}`,
      providerStatus: "processed",
      processedAt: new Date(),
      providerMetadata: {
        mode: "mock",
        paymentId: input.paymentId,
        amountMinor: input.amountMinor.toString()
      }
    };
  }
}

export type PayHereConfig = {
  merchantId: string;
  merchantSecret: string;
  checkoutUrl: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  defaultPhone: string;
  defaultAddress: string;
  defaultCity: string;
  defaultCountry: string;
};

export class PayHerePaymentProvider implements PaymentProvider {
  readonly name = "payhere";

  constructor(private readonly config: PayHereConfig) {}

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const amount = formatMinorAmount(input.amountMinor);
    const checkoutFields: Record<string, string> = {
      merchant_id: this.config.merchantId,
      return_url: this.config.returnUrl,
      cancel_url: this.config.cancelUrl,
      notify_url: this.config.notifyUrl,
      order_id: input.paymentId,
      items: input.description,
      currency: input.currency,
      amount,
      first_name: firstName(input.patientName),
      last_name: lastName(input.patientName),
      email: input.patientEmail ?? "",
      phone: input.patientPhone?.trim() || this.config.defaultPhone,
      address: this.config.defaultAddress,
      city: this.config.defaultCity,
      country: this.config.defaultCountry,
      custom_1: input.appointmentId,
      custom_2: input.patientId,
      hash: createPayHereCheckoutHash({
        merchantId: this.config.merchantId,
        orderId: input.paymentId,
        amount,
        currency: input.currency,
        merchantSecret: this.config.merchantSecret
      })
    };

    return {
      provider: this.name,
      providerOrderId: input.paymentId,
      providerStatus: "pending",
      checkoutUrl: this.config.checkoutUrl,
      checkoutFields,
      expiresAt: input.expiresAt ?? null,
      providerMetadata: {
        checkoutMode: "form_post"
      }
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent> {
    const payload = asRecord(input.payload);
    const merchantId = requireString(payload, "merchant_id");
    const orderId = requireString(payload, "order_id");
    const payhereAmount = requireString(payload, "payhere_amount");
    const currency = requireString(payload, "payhere_currency").toUpperCase();
    const statusCode = requireString(payload, "status_code");
    const md5sig = requireString(payload, "md5sig");

    if (merchantId !== this.config.merchantId) {
      throw new PaymentProviderError("Invalid PayHere merchant", "PAYMENT_WEBHOOK_INVALID_MERCHANT", 401);
    }

    const expectedSignature = createPayHereNotificationSignature({
      merchantId,
      orderId,
      payhereAmount,
      currency,
      statusCode,
      merchantSecret: this.config.merchantSecret
    });

    if (!constantTimeEqual(md5sig.toUpperCase(), expectedSignature)) {
      throw new PaymentProviderError("Invalid PayHere signature", "PAYMENT_WEBHOOK_INVALID_SIGNATURE", 401);
    }

    const providerPaymentId = getString(payload, "payment_id");

    return {
      provider: this.name,
      providerEventId: `payhere|${orderId}|${providerPaymentId ?? "none"}|${statusCode}`,
      providerPaymentId,
      internalPaymentId: orderId,
      status: parsePayHereStatus(statusCode),
      amountMinor: parseDecimalAmountToMinor(payhereAmount),
      currency,
      rawStatus: statusCode,
      paymentMethod: getString(payload, "method"),
      paidAt: statusCode === "2" ? new Date() : null,
      payload
    };
  }

  async createRefund(input: CreateRefundInput): Promise<CreateRefundResult> {
    return {
      provider: this.name,
      providerRefundId: `manual-payhere-refund-${input.refundId}`,
      providerStatus: "manual_required",
      processedAt: new Date(),
      providerMetadata: {
        manualRequired: true,
        paymentId: input.paymentId,
        providerPaymentId: input.providerPaymentId ?? null,
        amountMinor: input.amountMinor.toString()
      }
    };
  }
}

async function markRefundFailed(prisma: PrismaClient, refundId: string, error: unknown) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "refunds"
      WHERE "id" = CAST(${refundId} AS uuid)
      FOR UPDATE
    `;
    const refund = await tx.refund.findUnique({
      where: { id: refundId }
    });

    if (!refund || refund.status === RefundStatus.PROCESSED) {
      return;
    }

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.FAILED,
        providerStatus: "failed",
        providerResponse: toJson({
          error: safeRefundError(error)
        }) as Prisma.InputJsonValue,
        processedAt: new Date(),
        lastVerificationAt: new Date(),
        adminNotes: safeRefundError(error)
      }
    });
    await tx.refundStatusHistory.create({
      data: {
        refundId: refund.id,
        fromStatus: refund.status,
        toStatus: RefundStatus.FAILED,
        reason: safeRefundError(error),
        metadata: toJson({
          error: safeRefundError(error)
        }) as Prisma.InputJsonValue
      }
    });
  });
}

export function createPayHereCheckoutHash(input: {
  merchantId: string;
  orderId: string;
  amount: string;
  currency: string;
  merchantSecret: string;
}) {
  return md5Upper(
    `${input.merchantId}${input.orderId}${input.amount}${input.currency}${md5Upper(input.merchantSecret)}`
  );
}

export function createPayHereNotificationSignature(input: {
  merchantId: string;
  orderId: string;
  payhereAmount: string;
  currency: string;
  statusCode: string;
  merchantSecret: string;
}) {
  return md5Upper(
    `${input.merchantId}${input.orderId}${input.payhereAmount}${input.currency}${input.statusCode}${md5Upper(
      input.merchantSecret
    )}`
  );
}

export function createMockWebhookSignature(
  payload: Record<string, unknown>,
  secret = "development-mock-payment-secret"
) {
  return createHmac("sha256", secret).update(stableJson(payload)).digest("hex");
}

export function parseGatewayResponse(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    provider: getString(record, "provider"),
    providerOrderId: getString(record, "providerOrderId"),
    providerStatus: getString(record, "providerStatus"),
    checkoutUrl: getString(record, "checkoutUrl"),
    checkoutFields:
      typeof record.checkoutFields === "object" && record.checkoutFields && !Array.isArray(record.checkoutFields)
        ? (record.checkoutFields as Record<string, string>)
        : undefined,
    expiresAt: getString(record, "expiresAt"),
    providerMetadata:
      typeof record.providerMetadata === "object" && record.providerMetadata
        ? (record.providerMetadata as Record<string, unknown>)
        : undefined,
    reconciliationRequired: record.reconciliationRequired === true
  };
}

export function toGatewayResponse(result: InitiatePaymentResult) {
  return toJson({
    provider: result.provider,
    providerOrderId: result.providerOrderId,
    providerPaymentId: result.providerPaymentId ?? null,
    providerStatus: result.providerStatus,
    checkoutUrl: result.checkoutUrl ?? null,
    checkoutFields: result.checkoutFields,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    providerMetadata: result.providerMetadata ?? {}
  });
}

function getStoredInitiationResult(
  gatewayResponse: Prisma.JsonValue | null,
  provider: string,
  paymentId: string
): InitiatePaymentResult {
  const stored = parseGatewayResponse(gatewayResponse);

  return {
    provider: stored?.provider ?? provider,
    providerOrderId: stored?.providerOrderId ?? paymentId,
    providerStatus: stored?.providerStatus ?? "stored",
    checkoutUrl: stored?.checkoutUrl ?? null,
    checkoutFields: stored?.checkoutFields,
    expiresAt: stored?.expiresAt ? new Date(stored.expiresAt) : null,
    providerMetadata: stored?.providerMetadata
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];

  if (!value) {
    throw new PaymentProviderError(`Missing ${key}`, "PAYMENT_PROVIDER_CONFIG_INVALID", 500, { key });
  }

  return value;
}

function requireString(payload: Record<string, unknown>, key: string) {
  const value = getString(payload, key);

  if (!value) {
    throw new PaymentProviderError("Payment webhook payload is missing a required field", "PAYMENT_WEBHOOK_INVALID_PAYLOAD", 400, {
      field: key
    });
  }

  return value;
}

function getString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError("Payment webhook payload must be an object", "PAYMENT_WEBHOOK_INVALID_PAYLOAD", 400);
  }

  return value as Record<string, unknown>;
}

function parsePayHereStatus(statusCode: string) {
  if (statusCode === "2") {
    return PaymentStatus.SUCCESSFUL;
  }

  if (statusCode === "0") {
    return PaymentStatus.PENDING;
  }

  if (statusCode === "-1") {
    return PaymentStatus.CANCELLED;
  }

  return PaymentStatus.FAILED;
}

function parseMockStatus(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "successful" || normalized === "success") {
    return PaymentStatus.SUCCESSFUL;
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return PaymentStatus.CANCELLED;
  }

  if (normalized === "pending") {
    return PaymentStatus.PENDING;
  }

  if (normalized === "failed" || normalized === "failure") {
    return PaymentStatus.FAILED;
  }

  throw new PaymentProviderError("Unsupported mock payment status", "PAYMENT_WEBHOOK_INVALID_STATUS", 400, {
    status
  });
}

function parseDecimalAmountToMinor(value: string) {
  const [majorPart = "0", minorPart = ""] = value.split(".");
  const normalizedMinor = `${minorPart}00`.slice(0, 2);

  return BigInt(majorPart) * 100n + BigInt(normalizedMinor);
}

function formatMinorAmount(amountMinor: bigint) {
  const major = amountMinor / 100n;
  const minor = amountMinor % 100n;

  return `${major.toString()}.${minor.toString().padStart(2, "0")}`;
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function lastName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);

  return parts.slice(1).join(" ") || "-";
}

function md5Upper(value: string) {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeader(headers: VerifyWebhookInput["headers"], name: string) {
  const target = name.toLowerCase();
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === target);
  const value = entry?.[1];

  return Array.isArray(value) ? value[0] : value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function safeRefundError(error: unknown) {
  if (error instanceof PaymentProviderError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return "REFUND_PROCESSING_FAILED";
}

function toJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  ) as T;
}
