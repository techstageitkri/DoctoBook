import { z } from "zod";

const emailSchema = z.string().email().trim().toLowerCase();
const passwordSchema = z.string().min(8).max(256);

export const registerSchema = z.strictObject({
  accountType: z.enum(["patient", "doctor"]).default("patient"),
  email: emailSchema,
  phone: z.string().trim().min(7).max(32).optional(),
  fullName: z.string().trim().min(2).max(160),
  password: passwordSchema,
  deviceId: z.string().trim().max(120).optional(),
  deviceName: z.string().trim().max(160).optional()
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  deviceId: z.string().trim().max(120).optional(),
  deviceName: z.string().trim().max(160).optional()
});

export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(32)
});

export const logoutSchema = refreshSchema;

export const browserRefreshSchema = z.strictObject({
  refreshToken: z.string().min(32).optional()
});

export const browserLogoutSchema = browserRefreshSchema;

export const requestEmailVerificationSchema = z.strictObject({
  email: emailSchema
});

export const verifyEmailSchema = z.strictObject({
  token: z.string().min(32)
});

export const forgotPasswordSchema = z.strictObject({
  email: emailSchema
});

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(32),
  newPassword: passwordSchema
});

export const changePasswordSchema = z.strictObject({
  currentPassword: passwordSchema,
  newPassword: passwordSchema
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type BrowserRefreshInput = z.infer<typeof browserRefreshSchema>;
export type BrowserLogoutInput = z.infer<typeof browserLogoutSchema>;
export type RequestEmailVerificationInput = z.infer<typeof requestEmailVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
