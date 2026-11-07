import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  errors?: string[];
  className?: string;
};

/**
 * Labelled input with hint and error text wired up for assistive tech
 * (label `for`, `aria-describedby`, `aria-invalid`).
 */
export function TextField({ name, label, hint, errors, className, ...inputProps }: TextFieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {errorId ? (
        <p id={errorId} className="text-sm text-danger">
          {errors!.join("；")}
        </p>
      ) : null}
    </div>
  );
}
