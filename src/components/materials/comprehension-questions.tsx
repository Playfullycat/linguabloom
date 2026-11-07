"use client";

import { Check, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { answerQuestionAction } from "@/modules/materials/actions";
import type { ClientQuestion } from "@/modules/materials/services/materials";

type Answered = NonNullable<ClientQuestion["answered"]>;

/** Comprehension questions, scored on the server; a wrong answer points back to the sentence. */
export function ComprehensionQuestions({
  contentId,
  questions,
  onShowSentence,
}: {
  contentId: string;
  questions: ClientQuestion[];
  onShowSentence?: (segment: number) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Answered>>(() =>
    Object.fromEntries(questions.flatMap((q) => (q.answered ? [[q.id, q.answered]] : []))),
  );
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(0);
  const correct = Object.values(answers).filter((a) => a.isCorrect).length;
  const done = Object.keys(answers).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted" aria-live="polite">
        {done === 0 ? `共 ${questions.length} 题，先凭记忆回答，再回原文找依据。` : `已答 ${done} / ${questions.length} 题，答对 ${correct} 题。`}
      </p>
      {questions.map((q, qi) => {
        const answered = answers[q.id];
        const draft = drafts[q.id];
        return (
          <fieldset key={q.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-[0.9375rem] font-medium text-ink">
              {qi + 1}. {q.prompt_zh}
              {q.prompt_en ? (
                <span lang="en" className="ml-2 text-muted">
                  {q.prompt_en}
                </span>
              ) : null}
            </legend>
            {q.options.map((option, i) => {
              const selected = (answered ? answered.choice : draft) === i;
              const isRight = answered && answered.correctAnswer === option;
              const isWrongPick = answered && selected && !isRight;
              return (
                <label
                  key={i}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                    isRight ? "border-mint bg-mint-soft" : isWrongPick ? "border-coral bg-coral-soft" : selected ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-soft",
                    answered && "cursor-default",
                  )}
                >
                  <input
                    type="radio"
                    name={`${contentId}-${q.id}`}
                    className="sr-only"
                    checked={selected}
                    disabled={Boolean(answered) || pending}
                    onChange={() => {
                      startedAt.current ||= Date.now();
                      setDrafts((d) => ({ ...d, [q.id]: i }));
                    }}
                  />
                  <span lang={/[a-z]/i.test(option) && !/[一-鿿]/.test(option) ? "en" : undefined} className="flex-1 text-ink">
                    {option}
                  </span>
                  {isRight ? <Check className="size-4 text-mint-ink" aria-label="正确答案" /> : isWrongPick ? <X className="size-4 text-coral-ink" aria-label="你的选择" /> : null}
                </label>
              );
            })}
            {answered ? (
              <p className={cn("text-sm", answered.isCorrect ? "text-mint-ink" : "text-coral-ink")}>
                {answered.isCorrect ? "答对了。" : `正确答案：${answered.correctAnswer}。`}
                <span className="text-muted">{answered.explanationZh}</span>
                {!answered.isCorrect && q.segment !== undefined && onShowSentence ? (
                  <button type="button" className="ml-2 text-primary-ink underline-offset-4 hover:underline" onClick={() => onShowSentence(q.segment!)}>
                    回到原句
                  </button>
                ) : null}
              </p>
            ) : (
              <div>
                <Button
                  size="sm"
                  variant="soft"
                  disabled={draft === undefined || pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const r = await answerQuestionAction({
                        contentId,
                        questionId: q.id,
                        choice: draft!,
                        clientRequestId: crypto.randomUUID(),
                        durationMs: startedAt.current ? Math.min(3_600_000, Date.now() - startedAt.current) : undefined,
                      });
                      startedAt.current = 0;
                      if (!r.ok) setError(r.error);
                      else setAnswers((a) => ({ ...a, [q.id]: { choice: draft!, isCorrect: r.data.isCorrect, correctAnswer: r.data.correctAnswer, explanationZh: r.data.explanationZh } }));
                    });
                  }}
                >
                  提交第 {qi + 1} 题
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
