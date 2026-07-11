import { z } from "zod";

const uuidSchema = z.string().uuid();
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createAvailabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startsAt: timeSchema,
  endsAt: timeSchema,
  slotIntervalMinutes: z.number().int().positive().max(240).optional().nullable(),
  maxPatients: z.number().int().positive().max(100).default(1),
  effectiveFrom: dateSchema.optional().nullable(),
  effectiveTo: dateSchema.optional().nullable(),
  isActive: z.boolean().default(true)
});

export const updateAvailabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startsAt: timeSchema.optional(),
  endsAt: timeSchema.optional(),
  slotIntervalMinutes: z.number().int().positive().max(240).optional().nullable(),
  maxPatients: z.number().int().positive().max(100).optional(),
  effectiveFrom: dateSchema.optional().nullable(),
  effectiveTo: dateSchema.optional().nullable(),
  isActive: z.boolean().optional()
});

export const createAvailabilityBreakSchema = z.object({
  startsAt: timeSchema,
  endsAt: timeSchema
});

export const createDoctorTimeOffSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  doctorClinicServiceId: uuidSchema.optional().nullable(),
  reason: z.string().trim().min(1).max(500).optional().nullable()
});

export type CreateAvailabilityRuleInput = z.infer<typeof createAvailabilityRuleSchema>;
export type UpdateAvailabilityRuleInput = z.infer<typeof updateAvailabilityRuleSchema>;
export type CreateAvailabilityBreakInput = z.infer<typeof createAvailabilityBreakSchema>;
export type CreateDoctorTimeOffInput = z.infer<typeof createDoctorTimeOffSchema>;
