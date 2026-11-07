"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RATING_LABELS, type Grade } from "@/modules/review/domain/cards";

const tone: Record<Grade, string> = {
  1: "border-coral/50 bg-coral-soft text-coral-ink hover:bg-coral-soft/70",
  2: "border-yellow/60 bg-yellow-soft text-yellow-ink hover:bg-yellow-soft/70",
  3: "border-mint/50 bg-mint-soft text-mint-ink hover:bg-mint-soft/70",
  4: "border-blue/50 bg-blue-soft text-blue-ink hover:bg-blue-soft/70",
};

/** The four FSRS ratings with plain-language labels (spec §2.3). Keys 1–4 work too. */
export function ReviewRatingBar({
  grades,
  onRate,
  disabled,
}: {
  grades: Grade[];
  onRate: (grade: Grade) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="这次记得怎么样？" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${grades.length}, minmax(0, 1fr))` }}>
      {grades.map((grade) => (
        <Button
          key={grade}
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onRate(grade)}
          className={cn("h-auto flex-col gap-0.5 border py-2.5", tone[grade])}
          title={RATING_LABELS[grade].meaning}
        >
          <span className="text-[0.9375rem] font-semibold">{RATING_LABELS[grade].zh}</span>
          <span className="text-[0.6875rem] font-normal opacity-80">
            <kbd className="font-sans">{grade}</kbd> · {RATING_LABELS[grade].en}
          </span>
        </Button>
      ))}
    </div>
  );
}
