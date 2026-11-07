import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-surface-soft text-muted",
        primary: "bg-primary-soft text-primary-ink",
        blue: "bg-blue-soft text-blue-ink",
        mint: "bg-mint-soft text-mint-ink",
        coral: "bg-coral-soft text-coral-ink",
        yellow: "bg-yellow-soft text-yellow-ink",
        outline: "border border-border-strong text-muted",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
