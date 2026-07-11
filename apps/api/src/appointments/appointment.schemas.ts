import { z } from "zod";

const uuidSchema = z.string().uuid();

export const createPatientAppointmentSchema = z
  .strictObject({
    appointmentSlotId: uuidSchema,
    attendingPatientId: uuidSchema.optional().nullable(),
    attendingDependentId: uuidSchema.optional().nullable(),
    reasonForVisit: z.string().trim().min(1).max(1000).optional().nullable(),
    bookingNotes: z.string().trim().min(1).max(1000).optional().nullable(),
    paymentPreference: z.enum(["online", "pay_at_clinic"])
  })
  .refine(
    (value) =>
      Boolean(value.attendingPatientId) !== Boolean(value.attendingDependentId),
    {
      message: "Exactly one attending patient or dependent is required"
    }
  );

export type CreatePatientAppointmentInput = z.infer<
  typeof createPatientAppointmentSchema
>;
