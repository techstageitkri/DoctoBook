import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalTextSchema = z.string().trim().min(1).max(160).optional();
const limitSchema = z.coerce.number().int().positive().max(500).default(50);

export const listPublicClinicsQuerySchema = z.strictObject({
  search: optionalTextSchema,
  city: optionalTextSchema,
  district: optionalTextSchema,
  specialtyId: uuidSchema.optional(),
  serviceId: uuidSchema.optional(),
  limit: limitSchema
});

export const listPublicDoctorsQuerySchema = z.strictObject({
  search: optionalTextSchema,
  specialtyId: uuidSchema.optional(),
  clinicId: uuidSchema.optional(),
  city: optionalTextSchema,
  district: optionalTextSchema,
  availableDate: dateSchema.optional(),
  serviceId: uuidSchema.optional(),
  minFeeMinor: z.coerce.number().int().nonnegative().optional(),
  maxFeeMinor: z.coerce.number().int().nonnegative().optional(),
  language: optionalTextSchema,
  minRating: z.coerce.number().min(0).max(5).optional(),
  limit: limitSchema
});

export const publicAvailabilityQuerySchema = z
  .strictObject({
    doctorId: uuidSchema.optional(),
    clinicId: uuidSchema.optional(),
    clinicLocationId: uuidSchema.optional(),
    specialtyId: uuidSchema.optional(),
    serviceId: uuidSchema.optional(),
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    limit: limitSchema
  })
  .refine((value) => !value.fromDate || !value.toDate || value.toDate >= value.fromDate, {
    message: "toDate must be on or after fromDate"
  });

export const doctorClinicAvailabilityQuerySchema = z
  .strictObject({
    serviceId: uuidSchema.optional(),
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    limit: limitSchema
  })
  .refine((value) => !value.fromDate || !value.toDate || value.toDate >= value.fromDate, {
    message: "toDate must be on or after fromDate"
  });

export type ListPublicClinicsQuery = z.infer<typeof listPublicClinicsQuerySchema>;
export type ListPublicDoctorsQuery = z.infer<typeof listPublicDoctorsQuerySchema>;
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;
export type DoctorClinicAvailabilityQuery = z.infer<
  typeof doctorClinicAvailabilityQuerySchema
>;
