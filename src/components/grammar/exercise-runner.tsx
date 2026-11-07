"use client";

import { Check, ChevronLeft, ChevronRight, NotebookPen, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { answerExerciseAction } from "@/modules/grammar/actions";
import type { ExerciseResult, ClientExercise } from "@/modules/grammar/services/grammar";

export const EXERCISE_TYPE_LABELS = { choice: "选择", cloze: "填空", order: "排序", correction: "改错", build: "造句" } as const;

type Draft = { choice: number | null; text: string; tokens: string[]; checked: boolean[]; showModels: boolean };
const emptyDraft = (ex: ClientExercise): Draft => ({
  choice: null,
  text: ex.prompt.type === "correction" ? ex.prompt.wrong_en : "",
  tokens: [],
  checked: ex.prompt.type === "build" ? ex.prompt.checklist_zh.map(() => false) : [],
  showModels: false,
});

/**
 * Runs a list of grammar exercises one at a time: choice, fill in, word
 * order, correct the sentence, and open sentence building with a self-check.
 * Every answer is scored on the server.
 */
export function ExerciseRunner({
  exercises,
  context,
  errorItemId,
  onComplete,
  initialResults = {},
}: {
  exercises: ClientExercise[];
  context: "practice" | "remediation" | "retest";
  errorItemId?: string;
  onComplete?: (results: Record<string, ExerciseResult>) => void;
  initialResults?: Record<string, { isCorrect: boolean | null }>;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [results, setResults] = useState<Record<string, ExerciseResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef<number>(0);
  const inputId = useId();

  const ex = exercises[index];
  if (!ex) return <p className="text-sm text-muted">这里还没有练习题。</p>;
  const draft = drafts[ex.id] ?? emptyDraft(ex);
  const result = results[ex.id];
  const setDraft = (d: Partial<Draft>) => {
    startedAt.current ||= Date.now();
    setDrafts((all) => ({ ...all, [ex.id]: { ...draft, ...d } }));
  };
  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter((r) => r.isCorrect).length;
  const p = ex.prompt;

  const responseFor = (): unknown => {
    switch (p.type) {
      case "choice":
        return { choice: draft.choice ?? -1 };
      case "cloze":
      case "correction":
        return { text: draft.text };
      case "order":
        return { tokens: draft.tokens };
      case "build":
        return { text: draft.text, checked: draft.checked };
    }
  };
  const canSubmit =
    p.type === "choice" ? draft.choice !== null : p.type === "order" ? draft.tokens.length === p.tokens.length : p.type === "build" ? draft.showModels : draft.text.trim().length > 0;

  const submit = () => {
    setError(null);
    const started = startedAt.current;
    startTransition(async () => {
      const r = await answerExerciseAction({
        exerciseId: ex.id,
        response: responseFor(),
        clientRequestId: crypto.randomUUID(),
        context,
        errorItemId,
        durationMs: started ? Math.min(3_600_000, Date.now() - started) : undefined,
      });
      startedAt.current = 0;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const next = { ...results, [ex.id]: r.result };
      setResults(next);
      if (onComplete && exercises.every((e) => next[e.id])) onComplete(next);
    });
  };

  const retry = () => {
    setResults(({ [ex.id]: _, ...rest }) => {
      void _;
      return rest;
    });
    setDrafts(({ [ex.id]: _, ...rest }) => {
      void _;
      return rest;
    });
  };

  const go = (i: number) => {
    setIndex(i);
    setError(null);
    requestAnimationFrame(() => document.getElementById(`${inputId}-title`)?.focus());
  };

  const locked = Boolean(result) || pending;
  const remaining = p.type === "order" ? (() => {
    const left = [...p.tokens];
    for (const t of draft.tokens) left.splice(left.indexOf(t), 1);
    return left;
  })() : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            第 {index + 1} / {exercises.length} 题 · {EXERCISE_TYPE_LABELS[ex.type]}
          </span>
          <span aria-live="polite">{answered > 0 ? `本轮答对 ${correct} / ${Object.values(results).filter((r) => r.isCorrect !== null).length}` : null}</span>
        </div>
        <ProgressBar value={answered / exercises.length} label="练习进度" />
        {context === "practice" ? (
          <ol className="flex flex-wrap gap-1.5" aria-label="题目列表">
            {exercises.map((e, i) => {
              const r = results[e.id] ?? (initialResults[e.id] ? { isCorrect: initialResults[e.id]!.isCorrect } : null);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === index ? "step" : undefined}
                    aria-label={`第 ${i + 1} 题${r ? (r.isCorrect === null ? "（已自评）" : r.isCorrect ? "（答对）" : "（答错）") : ""}`}
                    className={cn(
                      "grid size-8 place-items-center rounded-lg border text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring",
                      i === index ? "border-primary text-primary-ink" : "border-border text-muted",
                      r?.isCorrect === true && "bg-mint-soft text-mint-ink",
                      r?.isCorrect === false && "bg-coral-soft text-coral-ink",
                      r && r.isCorrect === null && "bg-blue-soft text-blue-ink",
                    )}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-3">
        <h3 id={`${inputId}-title`} tabIndex={-1} className="text-[0.9375rem] font-semibold text-ink outline-none">
          {p.type === "choice"
            ? (p.prompt_zh ?? "选出正确答案")
            : p.type === "cloze"
              ? (p.instructions_zh ?? "填空")
              : p.type === "order"
                ? "把词语排成正确的句子"
                : p.type === "correction"
                  ? "这句话有错，改成正确的句子"
                  : p.task_zh}
        </h3>

        {p.type === "choice" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">选项</legend>
            {p.prompt_en ? (
              <p lang="en" className="mb-1 text-lg text-ink">
                {p.prompt_en}
              </p>
            ) : null}
            {p.options.map((o, i) => {
              const selected = draft.choice === i;
              const isRight = result && result.correctAnswer === o;
              const wrongPick = result && selected && !isRight;
              return (
                <label
                  key={i}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                    isRight ? "border-mint bg-mint-soft" : wrongPick ? "border-coral bg-coral-soft" : selected ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-soft",
                    locked && "cursor-default",
                  )}
                >
                  <input type="radio" name={`ex-${ex.id}`} className="sr-only" checked={selected} disabled={locked} onChange={() => setDraft({ choice: i })} />
                  <span lang="en" className="flex-1 text-[0.9375rem] text-ink">
                    {o}
                  </span>
                  {isRight ? <Check className="size-4 text-mint-ink" aria-label="正确答案" /> : wrongPick ? <X className="size-4 text-coral-ink" aria-label="你的选择" /> : null}
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {p.type === "cloze" ? (
          <div className="flex flex-col gap-2">
            <p lang="en" className="text-lg text-ink">
              {p.sentence_en.split("___")[0]}
              <span className="mx-1 inline-block min-w-16 border-b-2 border-primary text-center text-primary-ink">{draft.text.trim() || "?"}</span>
              {p.sentence_en.split("___")[1]}
            </p>
            <p className="text-sm text-muted">{p.translation_zh}</p>
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              填入空格
            </label>
            <Input
              id={inputId}
              lang="en"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={draft.text}
              disabled={locked}
              onChange={(e) => setDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit && !locked) submit();
              }}
              className="max-w-xs"
            />
          </div>
        ) : null}

        {p.type === "order" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{p.translation_zh}</p>
            <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-dashed border-border-strong p-2" aria-label="你的句子">
              {draft.tokens.length === 0 ? <span className="px-1 text-sm text-muted">按顺序点下面的词</span> : null}
              {draft.tokens.map((t, i) => (
                <button
                  key={`${t}-${i}`}
                  type="button"
                  lang="en"
                  disabled={locked}
                  onClick={() => setDraft({ tokens: draft.tokens.filter((_, k) => k !== i) })}
                  aria-label={`移除 ${t}`}
                  className="rounded-lg bg-primary-soft px-3 py-1.5 text-[0.9375rem] text-primary-ink focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="可选的词">
              {remaining.map((t, i) => (
                <button
                  key={`${t}-${i}`}
                  type="button"
                  lang="en"
                  disabled={locked}
                  onClick={() => setDraft({ tokens: [...draft.tokens, t] })}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.9375rem] text-ink hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {p.type === "correction" ? (
          <div className="flex flex-col gap-2">
            <p lang="en" className="rounded-xl bg-coral-soft px-3.5 py-2.5 text-[0.9375rem] text-coral-ink">
              <span className="sr-only">有错的句子：</span>
              {p.wrong_en}
            </p>
            {p.translation_zh ? <p className="text-sm text-muted">{p.translation_zh}</p> : null}
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              改正后的句子
            </label>
            <Input
              id={inputId}
              lang="en"
              autoComplete="off"
              spellCheck={false}
              value={draft.text}
              disabled={locked}
              onChange={(e) => setDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit && !locked) submit();
              }}
            />
          </div>
        ) : null}

        {p.type === "build" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              写下你的句子
            </label>
            <textarea
              id={inputId}
              lang="en"
              rows={3}
              maxLength={1000}
              value={draft.text}
              disabled={locked || draft.showModels}
              onChange={(e) => setDraft({ text: e.target.value })}
              className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-ring"
            />
            {!draft.showModels ? (
              <div>
                <Button variant="soft" disabled={!draft.text.trim()} onClick={() => setDraft({ showModels: true })}>
                  写好了，对照检查
                </Button>
              </div>
            ) : (
              <fieldset className="flex flex-col gap-2 rounded-xl bg-surface-soft p-3">
                <legend className="text-sm font-medium text-ink">对照下面几点，勾出你做到的（自动批改要等 AI 上线）</legend>
                {p.checklist_zh.map((c, i) => (
                  <label key={i} className="flex min-h-10 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-primary)]"
                      checked={draft.checked[i] ?? false}
                      disabled={locked}
                      onChange={(e) => setDraft({ checked: draft.checked.map((v, k) => (k === i ? e.target.checked : v)) })}
                    />
                    {c}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        ) : null}
      </section>

      {result ? (
        <div className="flex flex-col gap-2">
          {result.isCorrect === null ? (
            <FormMessage tone="success">已记录你的自评（{Math.round(result.score * 100)}%）。看看示范句：</FormMessage>
          ) : (
            <FormMessage tone={result.isCorrect ? "success" : "error"}>
              <p className="font-medium">{result.isCorrect ? "答对了！" : "还不太对。"}</p>
              {!result.isCorrect && result.correctAnswer ? (
                <p className="mt-0.5">
                  正确答案：<span lang="en">{result.correctAnswer}</span>
                </p>
              ) : null}
            </FormMessage>
          )}
          {result.modelAnswers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {result.modelAnswers.map((m) => (
                <li key={m} lang="en">
                  · {m}
                </li>
              ))}
            </ul>
          ) : null}
          {result.explanationZh ? <p className="text-sm text-muted">{result.explanationZh}</p> : null}
          {result.errorRecorded ? (
            <p className="flex items-center gap-1.5 text-sm text-coral-ink">
              <NotebookPen className="size-4" aria-hidden="true" />
              已记入
              <Link href="/errors" className="underline underline-offset-4">
                错误本
              </Link>
              ，同类错误再出现时会安排补救练习。
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {!result ? (
            <Button onClick={submit} disabled={!canSubmit || pending}>
              {p.type === "build" ? "提交自评" : "检查"}
            </Button>
          ) : context === "practice" ? (
            <Button variant="ghost" onClick={retry}>
              <RotateCcw aria-hidden="true" />
              再做一次
            </Button>
          ) : null}
          {result && index < exercises.length - 1 ? <Button onClick={() => go(index + 1)}>下一题</Button> : null}
        </div>
        {context === "practice" ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="上一道" disabled={index === 0} onClick={() => go(index - 1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="下一道" disabled={index >= exercises.length - 1} onClick={() => go(index + 1)}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <Badge>{context === "retest" ? "再测" : "补救练习"}</Badge>
        )}
      </div>
    </div>
  );
}
