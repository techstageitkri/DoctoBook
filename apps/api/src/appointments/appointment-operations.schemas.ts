import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const statusSchema = z.enum([
  "pending_payment",
  "confirmed",
  "checked_in",
  "waiting",
  "in_progress",
  "completed",
  "cancelled_by_patient",
  "cancelled_by_clinic",
  "cancelled_by_admin",
  "no_show",
  "expired"
]);

const positiveAmountSchema = z
  .union([z.string().regex(/^\d+$/u), z.number().int().nonnegative()])
  .transform((value) => BigInt(value));

export const listAppointmentsQuerySchema = z.strictObject({
  date: dateSchema.optional(),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
  status: statusSchema.optional(),
  doctorId: uuidSchema.optional(),
  clinicLocationId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const updateAppointmentStatusSchema = z.strictObject({
  status: z.enum(["checked_in", "waiting", "in_progress", "completed", "no_show"]),
  reason: z.string().trim().min(1).max(1000).optional().nullable(),
  queueNumber: z.coerce.number().int().min(1).max(9999).optional(),
  internalNotes: z.string().trim().min(1).max(2000).optional().nullable()
});

export const cancelAppointmentSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
  overridePolicy: z.boolean().optional().default(false)
});

export const recordOfflinePaymentSchema = z.strictObject({
  amountMinor: positiveAmountSchema.optional(),
  paymentMethod: z.string().trim().min(1).max(80).optional().default("cash"),
  reason: z.string().trim().min(1).max(1000).optional().nullable()
});

export const rescheduleOptionsQuerySchema = z.strictObject({
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const rescheduleAppointmentSchema = z.strictObject({
  replacementSlotId: uuidSchema,
  reason: z.string().trim().min(1).max(1000).optional().nullable()
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;
export type RecordOfflinePaymentInput = z.infer<typeof recordOfflinePaymentSchema>;
export type RescheduleOptionsQuery = z.infer<typeof rescheduleOptionsQuerySchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
