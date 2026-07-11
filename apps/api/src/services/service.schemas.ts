import { z } from "zod";
import { PaymentMode } from "@doctobook/database";

const uuidSchema = z.string().uuid();
const nullableTextSchema = z.string().trim().min(1).optional().nullable();
const paymentModeSchema = z.nativeEnum(PaymentMode).optional().nullable();

export const createMasterServiceSchema = z.strictObject({
  name: z.string().trim().min(2).max(140),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: nullableTextSchema,
  defaultDurationMinutes: z.number().int().positive().max(720),
  isActive: z.boolean().default(true)
});

export const updateMasterServiceSchema = createMasterServiceSchema.partial();

export const createClinicServiceSchema = z.strictObject({
  serviceId: uuidSchema,
  displayName: z.string().trim().min(1).max(160).optional().nullable(),
  description: nullableTextSchema,
  isActive: z.boolean().default(true)
});

export const updateClinicServiceSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(160).optional().nullable(),
  description: nullableTextSchema,
  isActive: z.boolean().optional()
});

export const createDoctorClinicServiceSchema = z.strictObject({
  clinicServiceId: uuidSchema,
  durationMinutes: z.number().int().positive().max(720),
  feeMinor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).default("LKR"),
  paymentMode: paymentModeSchema,
  cancellationWindowMinutes: z.number().int().positive().max(10080).optional().nullable(),
  rescheduleWindowMinutes: z.number().int().positive().max(10080).optional().nullable(),
  maxReschedules: z.number().int().min(0).max(20).optional().nullable(),
  isActive: z.boolean().default(true)
});

export const updateDoctorClinicServiceSchema = z.strictObject({
  durationMinutes: z.number().int().positive().max(720).optional(),
  feeMinor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  paymentMode: paymentModeSchema,
  cancellationWindowMinutes: z.number().int().positive().max(10080).optional().nullable(),
  rescheduleWindowMinutes: z.number().int().positive().max(10080).optional().nullable(),
  maxReschedules: z.number().int().min(0).max(20).optional().nullable(),
  isActive: z.boolean().optional()
});

export type CreateMasterServiceInput = z.infer<typeof createMasterServiceSchema>;
export type UpdateMasterServiceInput = z.infer<typeof updateMasterServiceSchema>;
export type CreateClinicServiceInput = z.infer<typeof createClinicServiceSchema>;
export type UpdateClinicServiceInput = z.infer<typeof updateClinicServiceSchema>;
export type CreateDoctorClinicServiceInput = z.infer<typeof createDoctorClinicServiceSchema>;
export type UpdateDoctorClinicServiceInput = z.infer<typeof updateDoctorClinicServiceSchema>;
