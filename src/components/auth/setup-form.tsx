"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { setupOwnerAction } from "@/modules/auth/actions";
import { initialFormState } from "@/modules/auth/schemas";

export function SetupForm({ requireToken }: { requireToken: boolean }) {
  const [state, formAction] = useActionState(setupOwnerAction, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "error" && state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}

      <TextField
        name="name"
        label="怎么称呼你"
        autoComplete="nickname"
        required
        maxLength={60}
        defaultValue={state.values?.name}
        errors={errors.name}
      />
      <TextField
        name="email"
        type="email"
        label="邮箱（用于登录）"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        errors={errors.email}
      />
      <TextField
        name="password"
        type="password"
        label="密码"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`至少 ${PASSWORD_MIN_LENGTH} 个字符。建议使用密码管理器生成。`}
        errors={errors.password}
      />
      <TextField
        name="confirmPassword"
        type="password"
        label="再次输入密码"
        autoComplete="new-password"
        required
        errors={errors.confirmPassword}
      />
      {requireToken ? (
        <TextField
          name="setupToken"
          type="password"
          label="初始化口令"
          autoComplete="off"
          required
          hint="服务器 .env 中 OWNER_SETUP_TOKEN 的值。"
          errors={errors.setupToken}
        />
      ) : null}

      <SubmitButton size="lg" className="mt-2 w-full" pendingLabel="正在创建…">
        创建账户并开始
      </SubmitButton>
    </form>
  );
}
