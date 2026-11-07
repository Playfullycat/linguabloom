import { cn } from "@/lib/utils";

/** Accessible linear progress (0–1). */
export function ProgressBar({
  value,
  label,
  className,
  tone = "primary",
}: {
  value: number;
  label: string;
  className?: string;
  tone?: "primary" | "mint";
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-soft", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-200 ease-[var(--ease-standard)]",
          tone === "mint" ? "bg-mint" : "bg-primary",
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
