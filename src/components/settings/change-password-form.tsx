"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { changePasswordAction } from "@/modules/auth/actions";
import { initialFormState } from "@/modules/auth/schemas";

/** `passwordChanged`: the page was reached right after a successful change. */
export function ChangePasswordForm({ passwordChanged }: { passwordChanged: boolean }) {
  const [state, formAction] = useActionState(changePasswordAction, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      {state.status === "error" && state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      {state.status === "idle" && passwordChanged ? (
        <FormMessage tone="success">密码已更新。其他设备上的登录已全部退出。</FormMessage>
      ) : null}
      <TextField
        name="currentPassword"
        type="password"
        label="当前密码"
        autoComplete="current-password"
        required
        errors={errors.currentPassword}
      />
      <TextField
        name="newPassword"
        type="password"
        label="新密码"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符。修改后，其他设备上的登录会自动退出。`}
        errors={errors.newPassword}
      />
      <TextField
        name="confirmPassword"
        type="password"
        label="再次输入新密码"
        autoComplete="new-password"
        required
        errors={errors.confirmPassword}
      />
      <div>
        <SubmitButton pendingLabel="正在更新…">更新密码</SubmitButton>
      </div>
    </form>
  );
}
