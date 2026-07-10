import { z } from "zod";

const emailSchema = z.string().email().trim().toLowerCase();
const passwordSchema = z.string().min(8).max(256);

export const registerSchema = z.object({
  accountType: z.enum(["patient", "doctor"]).default("patient"),
  email: emailSchema,
  phone: z.string().trim().min(7).max(32).optional(),
  fullName: z.string().trim().min(2).max(160),
  password: passwordSchema,
  deviceId: z.string().trim().max(120).optional(),
  deviceName: z.string().trim().max(160).optional()
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  deviceId: z.string().trim().max(120).optional(),
  deviceName: z.string().trim().max(160).optional()
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32)
});

export const logoutSchema = refreshSchema;

export const requestEmailVerificationSchema = z.object({
  email: emailSchema
});

export const verifyEmailSchema = z.object({
  token: z.string().min(32)
});

export const forgotPasswordSchema = z.object({
  email: emailSchema
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  newPassword: passwordSchema
});

export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type RequestEmailVerificationInput = z.infer<typeof requestEmailVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
