import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

/** Shared by Server Actions (authoritative) and forms (hints). */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "邮箱太长了")
  .pipe(z.email("请输入有效的邮箱地址"));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 个字符`);

export const setupSchema = z
  .object({
    name: z.string().trim().min(1, "请填写称呼").max(60, "称呼最多 60 个字符"),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
    setupToken: z.string().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的密码不一致",
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码").max(PASSWORD_MAX_LENGTH, "密码不正确"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的新密码不一致",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "新密码不能和当前密码相同",
  });

/** Uniform result shape for form Server Actions (used with useActionState). */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Non-secret values to re-fill after an error (never passwords). */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

export function fieldErrorsFrom(error: z.ZodError): FormState["fieldErrors"] {
  return z.flattenError(error).fieldErrors as FormState["fieldErrors"];
}
