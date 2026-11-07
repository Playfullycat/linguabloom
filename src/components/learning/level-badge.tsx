import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CEFR_LEVEL_LABELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";

const levelTone: Record<CefrLevel, BadgeTone> = {
  pre_a1: "coral",
  a1: "yellow",
  a2: "mint",
  b1: "blue",
  b2: "primary",
  c1: "primary",
  c2: "outline",
};

type LevelBadgeProps = {
  level: CefrLevel;
  /** Marks an estimate (e.g. from a short diagnostic) rather than a confirmed level. */
  estimated?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export function LevelBadge({ level, estimated = false, size = "md", className }: LevelBadgeProps) {
  const label = CEFR_LEVEL_LABELS[level];
  return (
    <Badge
      tone={levelTone[level]}
      size={size}
      className={cn("font-semibold tabular-nums", className)}
      title={estimated ? `${label}（初步估计）` : `CEFR ${label}`}
    >
      {label}
      {estimated ? <span className="font-normal opacity-80">· 初步</span> : null}
    </Badge>
  );
}
