import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 44px minimum height (spec §6.4).
        "h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 text-[0.9375rem] text-ink",
        "placeholder:text-muted/70 transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20",
        "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
