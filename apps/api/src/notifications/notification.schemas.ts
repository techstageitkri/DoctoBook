import { z } from "zod";

export const notificationChannelSchema = z.enum(["email", "sms", "push"]);
export const scopeTypeSchema = z.enum(["platform", "clinic"]);

export const listNotificationTemplatesQuerySchema = z.strictObject({
  eventCode: z.string().trim().min(1).max(120).optional(),
  channel: notificationChannelSchema.optional(),
  scopeType: scopeTypeSchema.optional(),
  scopeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const upsertNotificationTemplateSchema = z
  .strictObject({
    scopeType: scopeTypeSchema.default("platform"),
    scopeId: z.string().uuid().optional().nullable(),
    eventCode: z.string().trim().min(1).max(120),
    channel: notificationChannelSchema,
    locale: z.string().trim().min(2).max(16).default("en"),
    subject: z.string().trim().max(240).optional().nullable(),
    body: z.string().trim().min(1),
    isActive: z.boolean().default(true)
  })
  .superRefine((value, context) => {
    if (value.scopeType === "platform" && value.scopeId) {
      context.addIssue({
        code: "custom",
        path: ["scopeId"],
        message: "Platform templates must not have a scope id"
      });
    }

    if (value.scopeType === "clinic" && !value.scopeId) {
      context.addIssue({
        code: "custom",
        path: ["scopeId"],
        message: "Clinic templates require a clinic scope id"
      });
    }
  });

export const listNotificationLogsQuerySchema = z.strictObject({
  eventCode: z.string().trim().min(1).max(120).optional(),
  channel: notificationChannelSchema.optional(),
  status: z.enum(["queued", "processing", "sent", "failed", "cancelled"]).optional(),
  userId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export type ListNotificationTemplatesQuery = z.infer<
  typeof listNotificationTemplatesQuerySchema
>;
export type UpsertNotificationTemplateInput = z.infer<typeof upsertNotificationTemplateSchema>;
export type ListNotificationLogsQuery = z.infer<typeof listNotificationLogsQuerySchema>;
