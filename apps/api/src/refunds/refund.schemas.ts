import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateTimeFilterSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected a valid date or datetime"
  });
const amountFilterSchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Expected a positive minor-unit amount")
  .transform((value) => BigInt(value));

export const refundStatusSchema = z.enum([
  "requested",
  "under_review",
  "approved",
  "rejected",
  "processing",
  "processed",
  "failed",
  "reconciliation_required"
]);

export const listRefundsQuerySchema = z
  .strictObject({
    status: refundStatusSchema.optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    clinicId: uuidSchema.optional(),
    patientId: uuidSchema.optional(),
    appointmentId: uuidSchema.optional(),
    paymentId: uuidSchema.optional(),
    from: dateTimeFilterSchema.optional(),
    to: dateTimeFilterSchema.optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    minimumAmount: amountFilterSchema.optional(),
    maximumAmount: amountFilterSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .superRefine((value, context) => {
    if (value.from && value.to && new Date(value.to) < new Date(value.from)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "End date must be on or after start date"
      });
    }

    if (
      value.minimumAmount !== undefined &&
      value.maximumAmount !== undefined &&
      value.maximumAmount < value.minimumAmount
    ) {
      context.addIssue({
        code: "custom",
        path: ["maximumAmount"],
        message: "Maximum amount must be greater than or equal to minimum amount"
      });
    }
  });

export const markManualRefundSchema = z.strictObject({
  providerReference: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(1000),
  refundedAt: dateTimeFilterSchema.optional()
});

export const markRefundReconciliationSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
  notes: z.string().trim().max(4000).optional().nullable(),
  providerResponse: z.unknown().optional()
});

export type ListRefundsQuery = z.infer<typeof listRefundsQuerySchema>;
export type MarkManualRefundInput = z.infer<typeof markManualRefundSchema>;
export type MarkRefundReconciliationInput = z.infer<typeof markRefundReconciliationSchema>;
