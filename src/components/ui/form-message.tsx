import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Form-level feedback. Icon + text, never colour alone. */
export function FormMessage({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-control)] px-3.5 py-3 text-sm",
        tone === "error" ? "bg-coral-soft text-coral-ink" : "bg-mint-soft text-mint-ink",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
