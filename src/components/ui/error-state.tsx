import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * Recoverable error message. Uses calm wording (spec §6.9) and pairs colour
 * with an icon and text so the state is not conveyed by colour alone.
 */
export function ErrorState({
  title = "这里暂时没有加载成功",
  description = "可以稍后再试一次。你的学习记录不会因此丢失。",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-coral/40 bg-coral-soft px-6 py-10 text-center",
        className,
      )}
    >
      <CircleAlert className="size-7 text-coral-ink" aria-hidden="true" />
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-base font-semibold text-ink">{title}</p>
        {description ? <div className="text-sm leading-relaxed text-muted">{description}</div> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
