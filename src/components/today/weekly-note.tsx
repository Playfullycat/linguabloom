"use client";

import { X } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { hideWeeklyNoteAction } from "@/modules/study-plan/actions";

/** Gentle note about study days this week. No streaks, no guilt; can be hidden. */
export function WeeklyNote({ activeDays, targetDays }: { activeDays: number; targetDays: number }) {
  const [pending, startTransition] = useTransition();
  const message =
    activeDays === 0
      ? `这周还没开始，目标是 ${targetDays} 天。今天学一点就是好的开始。`
      : activeDays >= targetDays
        ? `这周已经学了 ${activeDays} 天，达到了每周 ${targetDays} 天的目标。`
        : `这周已经学了 ${activeDays} 天，目标是 ${targetDays} 天。`;
  return (
    <div className="flex items-start justify-between gap-2 rounded-2xl bg-mint-soft px-4 py-3 text-sm text-mint-ink">
      <p>{message}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        className="-my-1 -mr-2 text-mint-ink hover:bg-mint-soft/60"
        aria-label="不再显示每周学习天数"
        disabled={pending}
        onClick={() => startTransition(async () => void (await hideWeeklyNoteAction()))}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
