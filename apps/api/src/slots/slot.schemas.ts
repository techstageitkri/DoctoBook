import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const regenerateSlotsSchema = z
  .strictObject({
    doctorClinicId: uuidSchema.optional(),
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    reason: z
      .enum([
        "scheduled",
        "availability_changed",
        "break_changed",
        "time_off_changed",
        "clinic_hours_changed",
        "clinic_closure_changed",
        "service_changed",
        "doctor_clinic_changed",
        "manual"
      ])
      .default("manual")
  })
  .refine((value) => !value.fromDate || !value.toDate || value.toDate >= value.fromDate, {
    message: "toDate must be on or after fromDate"
  });

export type RegenerateSlotsInput = z.infer<typeof regenerateSlotsSchema>;
