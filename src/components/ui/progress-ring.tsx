import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ProgressRingProps = {
  /** 0–1. Values outside the range are clamped. */
  value: number;
  /** Accessible description, e.g. "Unit 3 完成 60%". */
  label: string;
  size?: number;
  strokeWidth?: number;
  tone?: "primary" | "mint" | "blue" | "coral" | "yellow";
  className?: string;
  /** Text shown in the centre; defaults to the percentage. */
  children?: ReactNode;
};

const toneClass = {
  primary: "stroke-primary",
  mint: "stroke-mint",
  blue: "stroke-blue",
  coral: "stroke-coral",
  yellow: "stroke-yellow",
} as const;

export function ProgressRing({
  value,
  label,
  size = 64,
  strokeWidth = 6,
  tone = "primary",
  className,
  children,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(clamped * 100);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-surface-soft" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={cn(toneClass[tone], "transition-[stroke-dashoffset] duration-200 ease-[var(--ease-standard)]")}
        />
      </svg>
      <span aria-hidden="true" className="absolute text-sm font-semibold tabular-nums text-ink">
        {children ?? `${percent}%`}
      </span>
    </div>
  );
}
