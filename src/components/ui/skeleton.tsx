import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Placeholder block for loading states. Decorative: hidden from assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-surface-soft", className)}
      {...props}
    />
  );
}

/** Generic page-level loading skeleton (header + cards). */
export function LoadingSkeleton({ label = "正在加载…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
