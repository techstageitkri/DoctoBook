import { z } from "zod";
import {
  ClinicAssociationStatus,
  DocumentReviewStatus,
  DoctorStatus,
  PaymentMode
} from "@doctobook/database";

const uuidSchema = z.string().uuid();
const emailSchema = z.string().email().trim().toLowerCase();
const phoneSchema = z.string().trim().min(7).max(32);
const passwordSchema = z.string().min(8).max(256);
const nullableTextSchema = z.string().trim().min(1).optional().nullable();
const languageSchema = z.string().trim().min(2).max(40);

export const registerDoctorSchema = z.strictObject({
  email: emailSchema,
  phone: phoneSchema.optional(),
  fullName: z.string().trim().min(2).max(160),
  password: passwordSchema,
  licenseNumber: z.string().trim().min(2).max(120),
  qualifications: nullableTextSchema,
  bio: nullableTextSchema,
  yearsExperience: z.number().int().min(0).max(80).optional().nullable(),
  languages: z.array(languageSchema).max(12).default([]),
  specialtyIds: z.array(uuidSchema).max(12).default([])
});

export const updateDoctorProfileSchema = z.strictObject({
  licenseNumber: z.string().trim().min(2).max(120).optional().nullable(),
  qualifications: nullableTextSchema,
  bio: nullableTextSchema,
  yearsExperience: z.number().int().min(0).max(80).optional().nullable(),
  languages: z.array(languageSchema).max(12).optional(),
  specialtyIds: z.array(uuidSchema).max(12).optional()
});

export const createDoctorDocumentSchema = z.strictObject({
  documentType: z.string().trim().min(2).max(80),
  storageProvider: z.string().trim().min(2).max(80).default("local"),
  bucket: z.string().trim().min(1).max(160).optional().nullable(),
  objectKey: z.string().trim().min(2),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().trim().min(1).max(160).optional().nullable()
});

export const listDoctorsQuerySchema = z.strictObject({
  status: z.nativeEnum(DoctorStatus).optional(),
  search: z.string().trim().min(1).max(120).optional()
});

export const rejectDoctorSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000)
});

export const doctorStatusReasonSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000).optional()
});

export const requestClinicAssociationSchema = z.strictObject({
  clinicId: uuidSchema,
  clinicLocationId: uuidSchema,
  defaultConsultationFeeMinor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).default("LKR"),
  paymentMode: z.nativeEnum(PaymentMode).optional().nullable(),
  defaultSlotIntervalMinutes: z.number().int().positive().max(240).default(15),
  bufferMinutes: z.number().int().min(0).max(240).default(0)
});

export const assignDoctorToClinicSchema = requestClinicAssociationSchema.omit({ clinicId: true }).extend({
  doctorId: uuidSchema
});

export const associationDecisionSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000).optional()
});

export const inviteDoctorSchema = z
  .strictObject({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    clinicLocationId: uuidSchema.optional()
  })
  .refine((value) => value.email || value.phone, {
    message: "Email or phone is required"
  });

export const clinicDocumentReviewSchema = z.strictObject({
  status: z.enum([DocumentReviewStatus.APPROVED, DocumentReviewStatus.REJECTED]),
  reason: z.string().trim().min(1).max(1000).optional()
});

export const listDoctorAssociationsQuerySchema = z.strictObject({
  status: z.nativeEnum(ClinicAssociationStatus).optional()
});

export type RegisterDoctorInput = z.infer<typeof registerDoctorSchema>;
export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;
export type CreateDoctorDocumentInput = z.infer<typeof createDoctorDocumentSchema>;
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuerySchema>;
export type RejectDoctorInput = z.infer<typeof rejectDoctorSchema>;
export type DoctorStatusReasonInput = z.infer<typeof doctorStatusReasonSchema>;
export type RequestClinicAssociationInput = z.infer<typeof requestClinicAssociationSchema>;
export type AssignDoctorToClinicInput = z.infer<typeof assignDoctorToClinicSchema>;
export type AssociationDecisionInput = z.infer<typeof associationDecisionSchema>;
export type InviteDoctorInput = z.infer<typeof inviteDoctorSchema>;
export type ClinicDocumentReviewInput = z.infer<typeof clinicDocumentReviewSchema>;
export type ListDoctorAssociationsQuery = z.infer<typeof listDoctorAssociationsQuerySchema>;
