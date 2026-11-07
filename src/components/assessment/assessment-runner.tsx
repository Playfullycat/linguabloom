"use client";

import { Check, Pause, SkipForward, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { answerAssessmentAction, completeAssessmentAction, skipAssessmentSkillAction } from "@/modules/assessment/actions";
import { DIAGNOSTIC_SKILL_LABELS } from "@/modules/assessment/content";
import type { AssessmentState } from "@/modules/assessment/services/assessment";

type Feedback = { isCorrect: boolean; explanationZh: string; correctAnswer: string };

const STATUS_LABELS = { pending: "未开始", in_progress: "进行中", done: "已完成", skipped: "已跳过" } as const;

export function AssessmentRunner({ initial, pauseHref }: { initial: AssessmentState; pauseHref: string }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(initial.writingSample ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shownAt = useRef<number | null>(null);
  /** State after the last answer, applied when the learner moves on. */
  const pendingNext = useRef<AssessmentState | null>(null);
  const inputId = useId();
  const writingId = useId();

  const current = state.current;
  const item = current?.item;
  const answeredTotal = state.skills.reduce((s, k) => s + k.answered, 0);
  const plannedTotal = state.skills.reduce((s, k) => s + (k.status === "skipped" ? k.answered : k.max), 0);

  const resetDraft = () => {
    setChoice(null);
    setText("");
    setFeedback(null);
    shownAt.current = Date.now();
  };

  const submit = (dontKnow = false) => {
    if (!item) return;
    setError(null);
    const started = shownAt.current;
    startTransition(async () => {
      const result = await answerAssessmentAction({
        sessionId: state.sessionId,
        itemId: item.id,
        ...(item.type === "choice" ? { choice: dontKnow ? -1 : (choice ?? -1) } : { text: dontKnow ? "" : text }),
        durationMs: started ? Math.min(3_600_000, Math.max(0, Date.now() - started)) : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedback({ isCorrect: result.data.isCorrect, explanationZh: result.data.explanationZh, correctAnswer: result.data.correctAnswer });
      // Keep showing this item with feedback; the next one appears on "下一题".
      setState((s) => ({ ...result.data.state, current: s.current }));
      pendingNext.current = result.data.state;
    });
  };

  const next = () => {
    if (pendingNext.current) setState(pendingNext.current);
    pendingNext.current = null;
    resetDraft();
    requestAnimationFrame(() => document.getElementById("assessment-item-title")?.focus());
  };

  const skipSkill = () => {
    if (!current) return;
    setError(null);
    startTransition(async () => {
      const result = await skipAssessmentSkillAction({ sessionId: state.sessionId, skill: current.skill });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      pendingNext.current = null;
      setState(result.data);
      resetDraft();
    });
  };

  const finish = () => {
    setError(null);
    startTransition(async () => {
      const result = await completeAssessmentAction({ sessionId: state.sessionId, writingSample: writing });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const canSubmit = item ? (item.type === "choice" ? choice !== null : text.trim().length > 0) : false;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="诊断各部分">
          {state.skills.map((s) => (
            <li key={s.skill}>
              <Badge tone={s.status === "done" ? "mint" : s.status === "skipped" ? "neutral" : current?.skill === s.skill ? "primary" : "outline"}>
                {DIAGNOSTIC_SKILL_LABELS[s.skill]} · {STATUS_LABELS[s.status]}
              </Badge>
            </li>
          ))}
        </ul>
        <ProgressBar value={plannedTotal === 0 ? 1 : answeredTotal / plannedTotal} label="诊断进度" />
      </div>

      {current && item ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>
                {DIAGNOSTIC_SKILL_LABELS[current.skill]} · 第 {current.index} / {current.max} 题
              </span>
            </div>
            <h2 id="assessment-item-title" tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              {item.prompt_zh ?? "选出正确答案"}
            </h2>

            {item.type === "choice" && item.passage_en ? (
              <p lang="en" className="rounded-2xl bg-surface-soft p-4 text-[0.9375rem] leading-relaxed text-ink">
                {item.passage_en}
              </p>
            ) : null}
            {item.type === "choice" && item.audio_en ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-blue-soft p-4">
                <div className="flex items-center gap-2">
                  <SpeakButton text={item.audio_en} label="播放录音" showText size="md" />
                  <span className="text-sm text-blue-ink">可以多听几遍，先不看文字。</span>
                </div>
                {feedback ? (
                  <p className="text-sm text-blue-ink">
                    原文：<span lang="en" className="font-medium">{item.audio_en}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
            {item.prompt_en ? (
              <p lang="en" className="text-xl font-medium text-ink">
                {item.prompt_en}
              </p>
            ) : null}

            {item.type === "choice" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">选项</legend>
                {item.options.map((option, index) => {
                  const selected = choice === index;
                  const isRight = feedback !== null && feedback.correctAnswer === option;
                  const isWrongPick = feedback !== null && selected && !isRight;
                  return (
                    <label
                      key={index}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                        isRight
                          ? "border-mint bg-mint-soft"
                          : isWrongPick
                            ? "border-coral bg-coral-soft"
                            : selected
                              ? "border-primary bg-primary-soft"
                              : "border-border bg-surface hover:bg-surface-soft",
                        feedback && "cursor-default",
                      )}
                    >
                      <input
                        type="radio"
                        name={`item-${item.id}`}
                        className="sr-only"
                        checked={selected}
                        disabled={feedback !== null || pending}
                        onChange={() => {
                          shownAt.current ??= Date.now();
                          setChoice(index);
                        }}
                      />
                      <span
                        aria-hidden="true"
                        className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", selected ? "border-primary" : "border-border-strong")}
                      >
                        {selected ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                      </span>
                      <span lang={/[a-z]/i.test(option) ? "en" : undefined} className="flex-1 text-[0.9375rem] text-ink">
                        {option}
                      </span>
                      {isRight ? <Check className="size-4 text-mint-ink" aria-label="正确答案" /> : isWrongPick ? <X className="size-4 text-coral-ink" aria-label="你的选择" /> : null}
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <div className="flex flex-col gap-2">
                <p lang="en" className="text-lg text-ink">
                  {item.sentence_en.split("___")[0]}
                  <span className="mx-1 inline-block min-w-16 border-b-2 border-primary text-center text-primary-ink">{feedback ? feedback.correctAnswer : "?"}</span>
                  {item.sentence_en.split("___")[1]}
                </p>
                <p className="text-sm text-muted">{item.translation_zh}</p>
                <label htmlFor={inputId} className="mt-1 text-sm font-medium text-ink">
                  填入空格的单词
                </label>
                <Input
                  id={inputId}
                  lang="en"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={text}
                  disabled={feedback !== null || pending}
                  onChange={(e) => {
                    shownAt.current ??= Date.now();
                    setText(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit && !feedback) submit();
                  }}
                  className="max-w-xs"
                />
              </div>
            )}

            {feedback ? (
              <FormMessage tone={feedback.isCorrect ? "success" : "error"}>
                <p className="font-medium">{feedback.isCorrect ? "答对了" : `正确答案：${feedback.correctAnswer}`}</p>
                <p className="mt-0.5">{feedback.explanationZh}</p>
              </FormMessage>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {feedback ? (
                  <Button onClick={next}>下一题</Button>
                ) : (
                  <>
                    <Button onClick={() => submit()} disabled={!canSubmit || pending}>
                      提交
                    </Button>
                    <Button variant="outline" onClick={() => submit(true)} disabled={pending}>
                      不会
                    </Button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={skipSkill} disabled={pending}>
                  <SkipForward aria-hidden="true" />
                  跳过{DIAGNOSTIC_SKILL_LABELS[current.skill]}部分
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={pauseHref}>
                    <Pause aria-hidden="true" />
                    暂停，稍后继续
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 id="assessment-item-title" tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              客观题部分完成了
            </h2>
            <p className="text-sm text-muted">最后两部分可以选做，不影响上面的估计。</p>
            <div className="flex flex-col gap-2">
              <label htmlFor={writingId} className="text-sm font-medium text-ink">
                写作（可选）：用英文写 2–3 句话介绍你自己
              </label>
              <textarea
                id={writingId}
                lang="en"
                rows={4}
                maxLength={2000}
                value={writing}
                onChange={(e) => setWriting(e.target.value)}
                placeholder="My name is … I live in … I want to learn English because …"
                className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-ring"
              />
              <p className="text-xs text-muted">会保存下来，方便以后对比自己的进步。自动写作评估要等 AI 反馈上线（Phase 3），现在不打分。</p>
            </div>
            <div className="rounded-2xl bg-surface-soft p-4 text-sm text-muted">
              <p className="font-medium text-ink">口语（暂时跳过）</p>
              <p className="mt-1">口语评估需要语音识别和 AI 反馈，在 Phase 3 上线。课程里的跟读和录音练习现在就能用。</p>
            </div>
            <div>
              <Button onClick={finish} disabled={pending}>
                查看初步结果
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
