"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { loginAction } from "@/modules/auth/actions";
import { initialFormState } from "@/modules/auth/schemas";

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "error" && state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      <TextField
        name="email"
        type="email"
        label="邮箱"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        errors={errors.email}
      />
      <TextField
        name="password"
        type="password"
        label="密码"
        autoComplete="current-password"
        required
        errors={errors.password}
      />
      <SubmitButton size="lg" className="mt-2 w-full" pendingLabel="正在登录…">
        登录
      </SubmitButton>
    </form>
  );
}
