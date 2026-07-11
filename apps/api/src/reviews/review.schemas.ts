import { z } from "zod";

export const createReviewSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(160).optional().nullable(),
  comment: z.string().trim().min(1).max(2000).optional().nullable()
});

export const updateReviewSchema = z.strictObject({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().min(1).max(160).optional().nullable(),
  comment: z.string().trim().min(1).max(2000).optional().nullable()
});

export const listPublicReviewsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional()
});

export const listAdminReviewsQuerySchema = z.strictObject({
  doctorId: z.string().uuid().optional(),
  clinicId: z.string().uuid().optional(),
  status: z.enum(["pending_moderation", "approved", "hidden", "rejected"]).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const moderateReviewSchema = z
  .strictObject({
    status: z.enum(["approved", "hidden", "rejected"]),
    reason: z.string().trim().max(1000).optional().nullable()
  })
  .superRefine((value, context) => {
    if ((value.status === "hidden" || value.status === "rejected") && !value.reason?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Moderation reason is required"
      });
    }
  });

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ListPublicReviewsQuery = z.infer<typeof listPublicReviewsQuerySchema>;
export type ListAdminReviewsQuery = z.infer<typeof listAdminReviewsQuerySchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
