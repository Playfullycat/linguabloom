"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CircleCheck,
  MessageCircle,
  RotateCcw,
  Shapes,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { moveTaskAction, regeneratePlanAction, restoreTaskAction, skipTaskAction, type PlanActionResult } from "@/modules/study-plan/actions";
import { SESSION_LENGTHS, type SessionLength } from "@/modules/study-plan/domain/session-templates";
import type { SkipReason, TodayPlan, TodayTask } from "@/modules/study-plan/services/plan";

const KIND: Record<TodayTask["kind"], { icon: LucideIcon; label: string; accent: string }> = {
  review: { icon: RotateCcw, label: "复习", accent: "bg-yellow-soft text-yellow-ink" },
  lesson: { icon: Shapes, label: "课程", accent: "bg-primary-soft text-primary-ink" },
  input: { icon: BookOpen, label: "输入", accent: "bg-blue-soft text-blue-ink" },
  output: { icon: MessageCircle, label: "输出", accent: "bg-mint-soft text-mint-ink" },
};

type Mode = "normal" | "review_only";

export function TodayPlanView({ plan, skipReasons }: { plan: TodayPlan; skipReasons: { value: SkipReason; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<string | null>(null);

  const run = (action: () => Promise<PlanActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  };

  const next = plan.tasks.find((t) => t.status === "pending");
  const allDone = plan.tasks.length > 0 && plan.tasks.every((t) => t.status === "done");
  const plannedMinutes = plan.tasks.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.minutes, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<string>
          ariaLabel="今天学习多久"
          value={String(plan.sessionMinutes)}
          onValueChange={(v) => run(() => regeneratePlanAction({ sessionMinutes: Number(v) as SessionLength }))}
          options={SESSION_LENGTHS.map((n) => ({ value: String(n), label: `${n} 分钟` }))}
        />
        <SegmentedControl<Mode>
          ariaLabel="学习模式"
          value={plan.mode}
          onValueChange={(mode) => run(() => regeneratePlanAction({ mode }))}
          options={[
            { value: "normal", label: "完整计划" },
            { value: "review_only", label: "只复习" },
          ]}
        />
      </div>

      {plan.tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong p-6 text-center">
          <p className="font-medium text-ink">{plan.mode === "review_only" ? "今天没有需要复习的卡片" : "暂时没有可以安排的任务"}</p>
          <p className="mt-1 text-sm text-muted">
            {plan.mode === "review_only" ? "切回“完整计划”就能学新课。" : "所有已发布的课程都学完了，可以去学习路径复习旧课。"}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="今日任务">
          {plan.tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              isFirst={index === 0}
              isLast={index === plan.tasks.length - 1}
              pending={pending}
              skipping={skipping === task.id}
              skipReasons={skipReasons}
              onMove={(direction) => run(() => moveTaskAction({ taskId: task.id, direction }))}
              onSkipStart={() => setSkipping(task.id)}
              onSkipCancel={() => setSkipping(null)}
              onSkip={(reason) => {
                setSkipping(null);
                run(() => skipTaskAction({ taskId: task.id, reason }));
              }}
              onRestore={() => run(() => restoreTaskAction(task.id))}
            />
          ))}
        </ol>
      )}

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted" aria-live="polite">
          {allDone ? "今天的计划都完成了，做得很好。" : `计划约 ${plannedMinutes} 分钟`}
        </p>
        {next ? (
          <Button asChild size="lg">
            <Link href={next.href}>
              开始学习
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  isFirst,
  isLast,
  pending,
  skipping,
  skipReasons,
  onMove,
  onSkipStart,
  onSkipCancel,
  onSkip,
  onRestore,
}: {
  task: TodayTask;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  skipping: boolean;
  skipReasons: { value: SkipReason; label: string }[];
  onMove: (direction: "up" | "down") => void;
  onSkipStart: () => void;
  onSkipCancel: () => void;
  onSkip: (reason: SkipReason) => void;
  onRestore: () => void;
}) {
  const kind = KIND[task.kind];
  const Icon = kind.icon;
  const titleId = useId();
  const [reason, setReason] = useState<SkipReason | null>(null);
  const skipped = task.status === "skipped";
  const done = task.status === "done";

  return (
    <li
      aria-labelledby={titleId}
      className={cn("rounded-2xl border bg-surface p-4", done ? "border-mint" : skipped ? "border-dashed border-border-strong" : "border-border")}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", done ? "bg-mint-soft text-mint-ink" : kind.accent, skipped && "opacity-60")}>
          {done ? <CircleCheck className="size-5" aria-hidden="true" /> : <Icon className="size-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className={cn("font-semibold text-ink", skipped && "text-muted line-through")}>
              {task.title}
            </h3>
            <Badge size="sm">{task.minutes} 分钟</Badge>
            {done ? <Badge size="sm" tone="mint">已完成</Badge> : null}
            {skipped ? (
              <Badge size="sm" tone="outline">
                已跳过 · {skipReasons.find((r) => r.value === task.skipReason)?.label ?? "未说明"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="sr-only">推荐原因：</span>
            {task.reason}
          </p>

          {skipping ? (
            <fieldset className="mt-3 rounded-xl bg-surface-soft p-3">
              <legend className="sr-only">跳过的原因</legend>
              <p className="text-sm font-medium text-ink" aria-hidden="true">
                为什么跳过？（帮系统以后安排得更合适）
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {skipReasons.map((r) => (
                  <label
                    key={r.value}
                    className={cn(
                      "cursor-pointer rounded-full border px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      reason === r.value ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink",
                    )}
                  >
                    <input type="radio" name={`skip-${task.id}`} className="sr-only" checked={reason === r.value} onChange={() => setReason(r.value)} />
                    {r.label}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={!reason || pending} onClick={() => reason && onSkip(reason)}>
                  确认跳过
                </Button>
                <Button size="sm" variant="ghost" onClick={onSkipCancel}>
                  取消
                </Button>
              </div>
            </fieldset>
          ) : null}
        </div>
      </div>

      {!skipping ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
          <Button variant="ghost" size="icon-sm" disabled={isFirst || pending} onClick={() => onMove("up")} aria-label={`上移：${task.title}`}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={isLast || pending} onClick={() => onMove("down")} aria-label={`下移：${task.title}`}>
            <ArrowDown aria-hidden="true" />
          </Button>
          {skipped ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={onRestore}>
              <Undo2 aria-hidden="true" />
              恢复
            </Button>
          ) : !done ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={onSkipStart}>
              跳过
            </Button>
          ) : null}
          {!skipped ? (
            <Button asChild variant={done ? "ghost" : "soft"} size="sm">
              <Link href={task.href}>
                {done ? "再看看" : "去做"}
                <span className="sr-only">：{task.title}</span>
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
