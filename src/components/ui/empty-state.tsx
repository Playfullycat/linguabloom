import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Optional call to action (button or link). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, children, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border-strong px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-base font-semibold text-ink">{title}</p>
        {description ? <div className="text-sm leading-relaxed text-muted">{description}</div> : null}
      </div>
      {children}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
