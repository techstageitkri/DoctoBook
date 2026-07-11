import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const reportStatusSchema = z.enum([
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

export const reportGroupBySchema = z.enum(["day", "week", "month"]).default("day");

export const reportQuerySchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    clinicId: uuidSchema.optional(),
    locationId: uuidSchema.optional(),
    clinicLocationId: uuidSchema.optional(),
    doctorId: uuidSchema.optional(),
    serviceId: uuidSchema.optional(),
    doctorClinicServiceId: uuidSchema.optional(),
    status: reportStatusSchema.optional(),
    groupBy: reportGroupBySchema,
    timezone: z.string().trim().min(1).max(80).default("Asia/Colombo"),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .transform((value) => ({
    ...value,
    from: value.from ?? value.fromDate,
    to: value.to ?? value.toDate,
    clinicLocationId: value.clinicLocationId ?? value.locationId,
    doctorClinicServiceId: value.doctorClinicServiceId
  }))
  .superRefine((value, context) => {
    if (value.from && value.to) {
      const from = new Date(`${value.from}T00:00:00.000Z`);
      const to = new Date(`${value.to}T00:00:00.000Z`);

      if (to < from) {
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: "Report end date must be on or after start date"
        });
      }

      const maxRangeMs = 366 * 24 * 60 * 60 * 1000;

      if (to.getTime() - from.getTime() > maxRangeMs) {
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: "Report date range cannot exceed 12 months"
        });
      }
    }
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
