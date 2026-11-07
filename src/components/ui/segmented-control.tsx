"use client";

import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
};

type SegmentedControlProps<T extends string> = {
  /**
   * Current choice. `null` renders no selection — use it while the real value
   * is not known yet (e.g. a browser-only preference during SSR) rather than
   * showing a wrong default.
   */
  value: T | null;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Required: describes what is being chosen. */
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Single-choice control built on Radix ToggleGroup (roving focus, arrow keys).
 * The user can never clear the selection.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value ?? ""}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      aria-label={ariaLabel}
      className={cn("inline-flex gap-1 rounded-[14px] bg-surface-soft p-1", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] font-medium text-muted",
            "transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-standard)]",
            "hover:text-ink data-[state=on]:bg-control-active data-[state=on]:text-ink data-[state=on]:shadow-card",
            "[&_svg]:size-4 [&_svg]:shrink-0",
            size === "sm" ? "h-8 px-2.5 text-sm" : "h-10 px-2.5 text-sm sm:px-3.5",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
