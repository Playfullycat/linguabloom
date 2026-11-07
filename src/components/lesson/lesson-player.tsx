"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, CircleAlert, LoaderCircle, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SPEECH_RATES, useSpeechRate, type SpeechRate } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";
import { completeLessonAction, submitStepAction } from "@/modules/curriculum/actions";
import type { PlayerLesson } from "@/modules/curriculum/services/queries";
import type { LessonSummaryResult } from "@/modules/curriculum/services/progress";

import { ChoiceStepView, ClozeStepView, MatchStepView, OrderStepView, orderDraftToTokens } from "./answer-steps";
import { LessonSummary } from "./lesson-summary";
import { OpenStepView } from "./open-steps";
import { DialogueView, NoticeView, OrientationView, TeachView, VocabView } from "./step-views";
import type { ChoiceDraft, ClozeDraft, Evaluation, MatchDraft, OpenDraft, OrderDraft, PlayerStep, StepDraft } from "./types";

const OBJECTIVE = new Set(["choice", "cloze", "order", "match"]);
const OPEN = new Set(["speak", "write"]);

function defaultDraft(step: PlayerStep): StepDraft {
  switch (step.type) {
    case "choice":
      return { choice: null };
    case "cloze":
      return { text: "" };
    case "order":
      return { picked: [] };
    case "match":
      return { selections: {} };
    case "speak":
    case "write":
      return { phase: "doing", text: "", hasRecording: false, checked: [] };
    default:
      return null;
  }
}

function canProceed(step: PlayerStep, draft: StepDraft): boolean {
  switch (step.type) {
    case "choice":
      return (draft as ChoiceDraft).choice !== null;
    case "cloze":
      return (draft as ClozeDraft).text.trim().length > 0;
    case "order":
      return (draft as OrderDraft).picked.length === step.tokens.length;
    case "match":
      return step.lefts.every((l) => Boolean((draft as MatchDraft).selections[l]));
    case "speak": {
      const d = draft as OpenDraft;
      return d.phase === "reviewing" || d.hasRecording || d.text.trim().length > 0;
    }
    case "write": {
      const d = draft as OpenDraft;
      return d.phase === "reviewing" || d.text.trim().length > 0;
    }
    default:
      return true;
  }
}

function buildResponse(step: PlayerStep, draft: StepDraft): unknown {
  switch (step.type) {
    case "choice":
      return { choice: (draft as ChoiceDraft).choice };
    case "cloze":
      return { text: (draft as ClozeDraft).text };
    case "order":
      return { tokens: orderDraftToTokens(step, draft as OrderDraft) };
    case "match":
      return { pairs: step.lefts.map((left) => ({ left, right: (draft as MatchDraft).selections[left] ?? "" })) };
    case "speak": {
      const d = draft as OpenDraft;
      return { mode: d.hasRecording ? "voice" : "text", text: d.text.trim() || undefined, checked: d.checked };
    }
    case "write": {
      const d = draft as OpenDraft;
      return { text: d.text.trim(), checked: d.checked };
    }
    default:
      return { viewed: true };
  }
}

const rateOptions = SPEECH_RATES.map((r) => ({
  value: String(r) as `${SpeechRate}`,
  label: r === 0.75 ? "慢" : r === 0.9 ? "中" : "正常",
  ariaLabel: `朗读速度 ${r} 倍`,
}));

export function LessonPlayer({ lesson }: { lesson: PlayerLesson }) {
  const { steps } = lesson;
  const resumeIndex =
    lesson.progress.status === "in_progress" && lesson.progress.currentStepKey
      ? Math.max(0, steps.findIndex((s) => s.id === lesson.progress.currentStepKey))
      : 0;

  const [index, setIndex] = useState(resumeIndex);
  const [drafts, setDrafts] = useState<Record<string, StepDraft>>({});
  const [results, setResults] = useState<Record<string, Evaluation>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<(LessonSummaryResult & { wordsAdded?: number }) | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [rate, setRate] = useSpeechRate();
  const stepStartedAt = useRef(0); // set when each step is shown (effect below)
  const pendingRequestIds = useRef<Record<string, string>>({});
  const stepTopRef = useRef<HTMLDivElement>(null);

  const step = steps[index]!;
  const draft = drafts[step.id] ?? defaultDraft(step);
  const evaluation = results[step.id] ?? null;
  const previous = lesson.attempts[step.id];
  const isObjective = OBJECTIVE.has(step.type);
  const isOpen = OPEN.has(step.type);
  const isLast = index === steps.length - 1;

  useEffect(() => {
    stepStartedAt.current = Date.now();
    stepTopRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [index]);

  const setDraft = (next: StepDraft) => setDrafts((d) => ({ ...d, [step.id]: next }));

  async function submit(response: unknown): Promise<Evaluation | null> {
    setSubmitting(true);
    setError(null);
    const requestId = (pendingRequestIds.current[step.id] ??= crypto.randomUUID());
    try {
      const outcome = await submitStepAction({
        lessonId: lesson.id,
        stepKey: step.id,
        response,
        clientRequestId: requestId,
        durationMs: Math.min(3_600_000, Date.now() - stepStartedAt.current),
      });
      if (!outcome.ok) {
        setError(outcome.error);
        delete pendingRequestIds.current[step.id];
        return null;
      }
      delete pendingRequestIds.current[step.id];
      const { isCorrect, selfScore, correctAnswer, modelAnswers, explanation } = outcome.result;
      return { isCorrect, selfScore, correctAnswer, modelAnswers, explanation };
    } catch {
      // Network problem: keep the request id so a retry cannot double-count.
      setError("网络好像断了，答案还没有保存。请检查网络后再点一次。");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const outcome = await completeLessonAction(lesson.id);
      if (outcome.ok) {
        setSummary(outcome.summary);
      } else {
        setError(outcome.error);
        const firstMissing = outcome.missingStepKeys?.[0];
        if (firstMissing) setIndex(Math.max(0, steps.findIndex((s) => s.id === firstMissing)));
      }
    } catch {
      setError("网络好像断了，请稍后再点一次“完成”。");
    } finally {
      setSubmitting(false);
    }
  }

  async function advance() {
    if (isLast) await finish();
    else setIndex((i) => i + 1);
  }

  async function onPrimary() {
    if (submitting) return;
    if (!isObjective && !isOpen) {
      if (!results[step.id] && !previous) {
        const result = await submit({ viewed: true });
        if (!result) return;
        setResults((r) => ({ ...r, [step.id]: result }));
      }
      await advance();
      return;
    }
    if (evaluation) {
      await advance();
      return;
    }
    if (isOpen && (draft as OpenDraft).phase === "doing") {
      setDraft({ ...(draft as OpenDraft), phase: "reviewing" });
      return;
    }
    const result = await submit(buildResponse(step, draft));
    if (result) setResults((r) => ({ ...r, [step.id]: result }));
  }

  function retry() {
    setResults((r) => {
      const next = { ...r };
      delete next[step.id];
      return next;
    });
    setDraft(defaultDraft(step));
  }

  if (summary) {
    return (
      <LessonSummary
        lesson={lesson}
        summary={summary}
        onRestart={() => {
          setSummary(null);
          setResults({});
          setDrafts({});
          setIndex(0);
        }}
      />
    );
  }

  const primaryLabel = (() => {
    if (!isObjective && !isOpen) return isLast ? "完成" : "继续";
    if (evaluation) return isLast ? "完成本课" : "继续";
    if (isOpen) return (draft as OpenDraft).phase === "doing" ? "对照示范" : "提交自评";
    return "检查答案";
  })();

  const helpPanel = (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <BookOpen className="size-4" aria-hidden="true" />
          本单元词汇
        </h2>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
          {lesson.vocabulary.map((v) => (
            <li key={v.key} className="flex items-start gap-1 text-sm">
              <SpeakButton text={v.text.split(" / ")[0]!} label={`朗读：${v.text}`} className="size-8 shrink-0" />
              <span className="flex min-w-0 flex-col py-1">
                <span lang="en" className="font-medium text-ink">{v.text}</span>
                <span className="text-xs text-muted">{v.zh}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      {lesson.grammarPoints.map((g) => (
        <section key={g.id} className="flex flex-col gap-1.5 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-ink">{g.title_zh}</h2>
          <p lang="en" className="rounded-lg bg-primary-soft px-3 py-2 text-xs font-medium whitespace-pre-line text-primary-ink">{g.pattern}</p>
        </section>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Button asChild variant="ghost" size="icon-sm" className="text-muted">
            <Link href={`/learn/units/${lesson.unitId}`} title="退出（进度已自动保存）">
              <X aria-hidden="true" />
              <span className="sr-only">退出课程，进度已自动保存</span>
            </Link>
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm">
                <span lang="en" className="font-semibold text-ink">{lesson.titleEn}</span>
                <span className="ml-2 hidden text-muted sm:inline">
                  {lesson.levelLabel} · {lesson.unitTitleEn} · 约 {lesson.estimatedMinutes} 分钟
                </span>
              </p>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {index + 1} / {steps.length}
              </span>
            </div>
            <ProgressBar value={(index + (evaluation || results[step.id] ? 1 : 0)) / steps.length} label={`课程进度 ${index + 1} / ${steps.length}`} />
          </div>
          <SegmentedControl
            ariaLabel="朗读速度"
            size="sm"
            value={String(rate) as `${SpeechRate}`}
            onValueChange={(v) => setRate(Number(v) as SpeechRate)}
            options={rateOptions}
            className="hidden md:inline-flex"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted lg:hidden"
            aria-expanded={showHelp}
            aria-controls="lesson-help"
            onClick={() => setShowHelp((v) => !v)}
          >
            <BookOpen aria-hidden="true" />
            <span className="sr-only">{showHelp ? "隐藏词汇和语法" : "显示词汇和语法"}</span>
          </Button>
        </div>
      </header>

      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canProceed(step, draft)) void onPrimary();
        }}
      >
        <div className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div ref={stepTopRef} tabIndex={-1} className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card outline-none sm:p-7">
            {previous && !evaluation && (isObjective || isOpen) ? (
              <p className="mb-4 rounded-xl bg-surface-soft px-3 py-2 text-xs text-muted">
                这一步之前已经做过
                {previous.lastIsCorrect === true ? "（答对了）" : previous.lastIsCorrect === false ? "（当时没答对）" : ""}
                。可以再做一次，复习不会改变首次成绩。
              </p>
            ) : null}
            <StepContent step={step} draft={draft} onDraft={setDraft} evaluation={evaluation} vocabulary={lesson.vocabulary} />
          </div>

          <div aria-live="polite">
            {evaluation ? <Feedback step={step} evaluation={evaluation} draft={draft} /> : null}
            {error ? (
              <FormMessage tone="error" className="mt-3">
                {error}
              </FormMessage>
            ) : null}
          </div>
        </div>

        <aside id="lesson-help" className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-4 lg:sticky lg:top-24 lg:block lg:self-start", showHelp ? "block" : "hidden")}>
          {helpPanel}
        </aside>
        </div>

        <div className="sticky bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0 || submitting}>
              <ArrowLeft aria-hidden="true" />
              <span className="hidden sm:inline">上一步</span>
            </Button>
            <div className="flex-1" />
            {evaluation && evaluation.isCorrect === false ? (
              <Button type="button" variant="outline" onClick={retry} disabled={submitting}>
                <RotateCcw aria-hidden="true" />
                再试一次
              </Button>
            ) : null}
            <Button type="submit" size="lg" disabled={submitting || !canProceed(step, draft)} className="min-w-32">
              {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {primaryLabel}
              {!submitting && (primaryLabel === "继续" || primaryLabel === "对照示范") ? <ArrowRight aria-hidden="true" /> : null}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function StepContent({
  step,
  draft,
  onDraft,
  evaluation,
  vocabulary,
}: {
  step: PlayerStep;
  draft: StepDraft;
  onDraft: (d: StepDraft) => void;
  evaluation: Evaluation | null;
  vocabulary: PlayerLesson["vocabulary"];
}) {
  switch (step.type) {
    case "orientation":
      return <OrientationView step={step} />;
    case "dialogue":
      return <DialogueView step={step} />;
    case "vocab":
      return <VocabView step={step} vocabulary={vocabulary} />;
    case "notice":
      return <NoticeView step={step} />;
    case "teach":
      return <TeachView step={step} />;
    case "choice":
      return <ChoiceStepView step={step} draft={draft as ChoiceDraft} onDraft={onDraft} evaluation={evaluation} />;
    case "cloze":
      return <ClozeStepView step={step} draft={draft as ClozeDraft} onDraft={onDraft} evaluation={evaluation} />;
    case "order":
      return <OrderStepView step={step} draft={draft as OrderDraft} onDraft={onDraft} evaluation={evaluation} />;
    case "match":
      return <MatchStepView step={step} draft={draft as MatchDraft} onDraft={onDraft} evaluation={evaluation} />;
    case "speak":
    case "write":
      return <OpenStepView step={step} draft={draft as OpenDraft} onDraft={onDraft} evaluation={evaluation} />;
  }
}

/** Spec §2.3: right answer first, then a short explanation; retry allowed. */
function Feedback({ step, evaluation, draft }: { step: PlayerStep; evaluation: Evaluation; draft: StepDraft }) {
  if (evaluation.isCorrect === true) {
    return (
      <div className="flex gap-3 rounded-2xl bg-mint-soft p-4 text-mint-ink">
        <Check className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">答对了！</p>
          {evaluation.explanation ? <p className="text-sm">{evaluation.explanation}</p> : null}
        </div>
      </div>
    );
  }
  if (evaluation.isCorrect === false) {
    return (
      <div className="flex gap-3 rounded-2xl bg-coral-soft p-4 text-coral-ink">
        <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">还不太对，值得再练一次。</p>
          {evaluation.correctAnswer ? (
            <p className="text-sm text-ink">
              正确答案：<span lang="en" className="font-semibold">{evaluation.correctAnswer}</span>
            </p>
          ) : null}
          {evaluation.explanation ? <p className="text-sm">{evaluation.explanation}</p> : null}
          <p className="text-xs opacity-80">可以点“再试一次”马上练习；首次成绩不会改变，这些内容之后会在复习里再出现。</p>
        </div>
      </div>
    );
  }
  if (step.type === "speak" || step.type === "write") {
    const total = step.checklist_zh.length;
    const done = Math.round((evaluation.selfScore ?? 0) * total);
    return (
      <div className="flex gap-3 rounded-2xl bg-mint-soft p-4 text-mint-ink">
        <Check className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">
            完成了！自评做到 {done} / {total} 项。
          </p>
          <p className="text-sm">
            {done === total ? "很好，意思都表达到了。" : "没做到的那几点，下次开口时留意一下就好。"}
            {step.type === "speak" && (draft as OpenDraft).hasRecording ? " 录音没有上传，也不会被保存。" : ""}
          </p>
        </div>
      </div>
    );
  }
  return null;
}
