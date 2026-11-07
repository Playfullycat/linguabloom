"use client";

import { BookOpen, Clock, MessageCircle, RotateCcw, Shapes, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DEFAULT_SESSION_LENGTH,
  SESSION_BLOCK_LABELS,
  SESSION_LENGTHS,
  STRAND_LABELS,
  getSessionTemplate,
  type SessionBlockKind,
  type SessionLength,
} from "@/modules/study-plan/domain/session-templates";

const blockIcon: Record<SessionBlockKind, LucideIcon> = {
  review: RotateCcw,
  lesson: Shapes,
  input: BookOpen,
  output: MessageCircle,
};

const blockAccent: Record<SessionBlockKind, string> = {
  review: "bg-yellow-soft text-yellow-ink",
  lesson: "bg-primary-soft text-primary-ink",
  input: "bg-blue-soft text-blue-ink",
  output: "bg-mint-soft text-mint-ink",
};

const lengthOptions = SESSION_LENGTHS.map((m) => ({
  value: String(m) as `${SessionLength}`,
  label: `${m} 分钟`,
}));

/**
 * Shows how a session of the chosen length is composed. Selection is local
 * for now; Phase 1 stores it in study_preferences and fills real tasks.
 */
export function SessionTemplatePicker() {
  const [length, setLength] = useState<SessionLength>(DEFAULT_SESSION_LENGTH);
  const blocks = getSessionTemplate(length);

  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        ariaLabel="学习时长"
        value={String(length) as `${SessionLength}`}
        onValueChange={(v) => setLength(Number(v) as SessionLength)}
        options={lengthOptions}
        className="w-full max-w-md [&>button]:flex-1"
      />
      <ol className="flex flex-col gap-2.5" aria-label={`${length} 分钟学习的组成`}>
        {blocks.map((block, index) => {
          const Icon = blockIcon[block.kind];
          const label = SESSION_BLOCK_LABELS[block.kind];
          return (
            <li
              key={`${block.kind}-${index}`}
              className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface-soft/60 p-3.5"
            >
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${blockAccent[block.kind]}`}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {label.title}
                  <Badge tone="neutral" size="sm">
                    {STRAND_LABELS[block.strand]}
                  </Badge>
                </span>
                <span className="text-sm text-muted">{label.detail}</span>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums text-muted">
                <Clock className="size-3.5" aria-hidden="true" />
                {block.minutes} 分钟
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
