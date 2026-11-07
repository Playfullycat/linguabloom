"use client";

import { CircleCheck, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ExerciseRunner } from "@/components/grammar/exercise-runner";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { completeRoundAction, resolveErrorAction, saveErrorNoteAction, startPracticeAction } from "@/modules/errors/actions";
import type { RoundOutcome } from "@/modules/errors/services/errors";
import type { ClientExercise } from "@/modules/grammar/services/grammar";

type Mode = "remediation" | "retest";

/**
 * Remediation round / retest for one error item, plus "go practise" and
 * "I've got this" for items without an exercise bank.
 */
export function ErrorPractice({
  itemId,
  status,
  canPractise,
  needsRemediation,
  retestDue,
  retestDueLabel,
  practiceHref,
}: {
  itemId: string;
  status: string;
  canPractise: boolean;
  needsRemediation: boolean;
  retestDue: boolean;
  retestDueLabel: string | null;
  practiceHref: string | null;
}) {
  const router = useRouter();
  const [round, setRound] = useState<{ mode: Mode; exercises: ClientExercise[] } | null>(null);
  const [outcome, setOutcome] = useState<RoundOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (mode: Mode) => {
    setError(null);
    setOutcome(null);
    startTransition(async () => {
      const r = await startPracticeAction({ itemId, mode });
      if (!r.ok) setError(r.error);
      else if (r.data.length === 0) setError("这个知识点暂时没有足够的练习题。");
      else setRound({ mode, exercises: r.data });
    });
  };

  const finish = (mode: Mode, exercises: ClientExercise[]) => {
    startTransition(async () => {
      const r = await completeRoundAction({ itemId, mode, exerciseIds: exercises.map((e) => e.id) });
      if (!r.ok) setError(r.error);
      else {
        setOutcome(r.data);
        router.refresh();
      }
    });
  };

  const resolve = () =>
    startTransition(async () => {
      const r = await resolveErrorAction(itemId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  const mode: Mode | null = retestDue ? "retest" : canPractise && status === "active" ? "remediation" : null;

  return (
    <div className="flex flex-col gap-4">
      {round ? (
        <ExerciseRunner key={`${round.mode}-${round.exercises.map((e) => e.id).join()}`} exercises={round.exercises} context={round.mode} errorItemId={itemId} onComplete={() => finish(round.mode, round.exercises)} />
      ) : null}

      {outcome ? (
        <FormMessage tone={outcome.passed ? "success" : "error"}>
          {outcome.mode === "remediation"
            ? outcome.passed
              ? `答对 ${outcome.correct} / ${outcome.total}，补救练习通过了！明天会换几道新题再测一次，确认真的掌握。`
              : `答对 ${outcome.correct} / ${outcome.total}。再看看讲解，稍后再试一次。`
            : outcome.passed
              ? `再测全部答对，这个错误标记为已解决。以后再出现会自动重新打开。`
              : `再测答对 ${outcome.correct} / ${outcome.total}，还需要再巩固一下，可以重新做补救练习。`}
        </FormMessage>
      ) : null}

      {!round || outcome ? (
        <div className="flex flex-wrap gap-2">
          {mode ? (
            <Button onClick={() => start(mode)} disabled={pending}>
              <Wrench aria-hidden="true" />
              {mode === "retest" ? "开始再测（2 道新题）" : needsRemediation ? "开始补救练习（3 道题）" : "做 3 道针对练习"}
            </Button>
          ) : null}
          {practiceHref && !canPractise ? (
            <Button asChild variant="soft">
              <Link href={practiceHref}>去原处练习</Link>
            </Button>
          ) : null}
          {status !== "resolved" ? (
            <Button variant="ghost" onClick={resolve} disabled={pending}>
              <CircleCheck aria-hidden="true" />
              我已经掌握了
            </Button>
          ) : null}
        </div>
      ) : null}
      {status === "retest" && !retestDue && retestDueLabel ? <p className="text-sm text-muted">补救练习已通过，{retestDueLabel}起可以再测。隔一天再测，才能看出是不是真的记住了。</p> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

export function ErrorNote({ itemId, initial }: { itemId: string; initial: string }) {
  const [note, setNote] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="error-note" className="text-sm font-medium text-ink">
        我的备注
      </label>
      <textarea
        id="error-note"
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="例如：中文“我很忙”没有动词，英语要加 am。"
        className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-ring"
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="soft"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveErrorNoteAction({ id: itemId, note });
              setMessage(r.ok ? "备注已保存。" : r.error);
            })
          }
        >
          保存备注
        </Button>
        {message ? (
          <span role="status" className="text-sm text-muted">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
