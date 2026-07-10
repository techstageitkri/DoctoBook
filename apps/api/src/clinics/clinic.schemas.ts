import { z } from "zod";
import { ClinicStatus, PaymentMode } from "@doctobook/database";

const uuidSchema = z.string().uuid();
const nullableUrlSchema = z.string().url().optional().nullable();
const nullableEmailSchema = z.string().email().trim().toLowerCase().optional().nullable();
const nullablePhoneSchema = z.string().trim().min(7).max(32).optional().nullable();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export const clinicStatusSchema = z.nativeEnum(ClinicStatus);

export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(180),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(180)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().optional().nullable(),
  email: nullableEmailSchema,
  phone: nullablePhoneSchema,
  websiteUrl: nullableUrlSchema,
  defaultPaymentMode: z.nativeEnum(PaymentMode).optional().nullable(),
  cancellationWindowMinutes: z.number().int().positive().optional().nullable(),
  refundProcessingDays: z.number().int().positive().optional().nullable()
});

export const updateClinicSchema = createClinicSchema.partial().omit({ slug: true }).extend({
  slug: createClinicSchema.shape.slug.optional()
});

export const updateClinicStatusSchema = z.object({
  status: clinicStatusSchema,
  reason: z.string().trim().min(1).max(500).optional()
});

export const listClinicsQuerySchema = z.object({
  status: clinicStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().default(false),
  search: z.string().trim().min(1).max(120).optional()
});

export const createClinicLocationSchema = z.object({
  name: z.string().trim().min(1).max(160).optional().nullable(),
  address: z.string().trim().min(3),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().max(100).optional().nullable(),
  province: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().length(2).default("LK"),
  timezone: z.string().trim().min(3).max(80).default("Asia/Colombo"),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  phone: nullablePhoneSchema,
  isPrimary: z.boolean().default(false),
  status: clinicStatusSchema.default(ClinicStatus.ACTIVE)
});

export const updateClinicLocationSchema = createClinicLocationSchema.partial();

export const setLocationHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensAt: timeSchema.optional().nullable(),
        closesAt: timeSchema.optional().nullable(),
        isClosed: z.boolean().default(false),
        effectiveFrom: dateSchema.optional().nullable(),
        effectiveTo: dateSchema.optional().nullable()
      })
    )
    .min(1)
});

export const createClosureSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500).optional().nullable()
});

export const assignClinicAdminSchema = z.object({
  userId: uuidSchema
});

export type CreateClinicInput = z.infer<typeof createClinicSchema>;
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;
export type UpdateClinicStatusInput = z.infer<typeof updateClinicStatusSchema>;
export type ListClinicsQuery = z.infer<typeof listClinicsQuerySchema>;
export type CreateClinicLocationInput = z.infer<typeof createClinicLocationSchema>;
export type UpdateClinicLocationInput = z.infer<typeof updateClinicLocationSchema>;
export type SetLocationHoursInput = z.infer<typeof setLocationHoursSchema>;
export type CreateClosureInput = z.infer<typeof createClosureSchema>;
export type AssignClinicAdminInput = z.infer<typeof assignClinicAdminSchema>;
