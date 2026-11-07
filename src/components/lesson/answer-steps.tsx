"use client";

import { Check, Headphones, RotateCcw, X } from "lucide-react";
import { useId, useRef } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSpeech } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";

import type { AnswerStepProps, ChoiceDraft, ClozeDraft, MatchDraft, OrderDraft, StepOf } from "./types";

// ----------------------------------------------------------------- choice ----

export function ChoiceStepView({ step, draft, onDraft, evaluation }: AnswerStepProps<StepOf<"choice">, ChoiceDraft>) {
  const name = useId();
  const { supported, speaking, play, stop } = useSpeech();
  const locked = evaluation !== null;

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 flex flex-col gap-2">
        {step.prompt_zh ? <span className="text-lg font-semibold text-ink">{step.prompt_zh}</span> : null}
        {step.prompt_en ? (
          <span className="flex items-center gap-1">
            <SpeakButton text={step.prompt_en.replace(/^"|"$/g, "")} />
            <span lang="en" className="text-lg font-medium text-ink">{step.prompt_en}</span>
          </span>
        ) : null}
      </legend>

      {step.audio_en ? (
        <div className="flex flex-col items-start gap-2 rounded-2xl bg-blue-soft p-4">
          <Button onClick={() => (speaking ? stop() : play(step.audio_en!))} disabled={!supported} aria-pressed={speaking}>
            <Headphones aria-hidden="true" />
            {speaking ? "停止" : "播放录音"}
          </Button>
          {!supported ? <p className="text-sm text-blue-ink">当前浏览器不支持朗读，下面直接显示原文：{step.audio_en}</p> : null}
          {locked && supported ? (
            <p className="text-sm text-blue-ink">
              原文：<span lang="en" className="font-medium">{step.audio_en}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {step.options.map((option, index) => {
          const selected = draft.choice === index;
          const isRight = locked && evaluation.correctAnswer === option;
          const isWrongPick = locked && selected && !isRight;
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
                locked && "cursor-default",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => onDraft({ choice: index })}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border-2",
                  selected ? "border-primary" : "border-border-strong",
                )}
              >
                {selected ? <span className="size-2.5 rounded-full bg-primary" /> : null}
              </span>
              <span lang={/[a-z]/i.test(option) ? "en" : undefined} className="flex-1 text-[0.9375rem] text-ink">
                {option}
              </span>
              {isRight ? (
                <span className="flex items-center gap-1 text-sm font-medium text-mint-ink">
                  <Check className="size-4" aria-hidden="true" />
                  正确答案
                </span>
              ) : isWrongPick ? (
                <span className="flex items-center gap-1 text-sm font-medium text-coral-ink">
                  <X className="size-4" aria-hidden="true" />
                  你的选择
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ cloze ----

export function ClozeStepView({ step, draft, onDraft, evaluation }: AnswerStepProps<StepOf<"cloze">, ClozeDraft>) {
  const inputId = useId();
  const [before, after] = step.sentence_en.split("___") as [string, string];
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{step.instructions_zh}</h2>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-lg">
        <span lang="en">{before}</span>
        <label htmlFor={inputId} className="sr-only">
          填空
        </label>
        <Input
          id={inputId}
          lang="en"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.text}
          disabled={evaluation !== null}
          onChange={(e) => onDraft({ text: e.target.value })}
          className={cn(
            "h-11 w-40 text-lg",
            evaluation?.isCorrect === true && "border-mint bg-mint-soft",
            evaluation?.isCorrect === false && "border-coral bg-coral-soft",
          )}
        />
        <span lang="en">{after}</span>
      </div>
      <p className="text-sm text-muted">{step.translation_zh}</p>
      {step.hint_zh ? <p className="text-sm text-muted">提示：{step.hint_zh}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ order ----

export function OrderStepView({ step, draft, onDraft, evaluation }: AnswerStepProps<StepOf<"order">, OrderDraft>) {
  const locked = evaluation !== null;
  const available = step.tokens.map((token, index) => ({ token, index })).filter(({ index }) => !draft.picked.includes(index));
  const lineRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{step.instructions_zh}</h2>
      <p className="text-sm text-muted">意思：{step.translation_zh}</p>

      <div
        ref={lineRef}
        aria-label="你排好的句子"
        className={cn(
          "flex min-h-16 flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed p-3",
          evaluation?.isCorrect === true ? "border-mint bg-mint-soft" : evaluation?.isCorrect === false ? "border-coral bg-coral-soft" : "border-border-strong",
        )}
      >
        {draft.picked.length === 0 ? <span className="text-sm text-muted">点击下面的词，按顺序排成句子</span> : null}
        {draft.picked.map((tokenIndex, position) => (
          <button
            key={`${tokenIndex}-${position}`}
            type="button"
            lang="en"
            disabled={locked}
            onClick={() => onDraft({ picked: draft.picked.filter((_, i) => i !== position) })}
            className="h-10 rounded-xl border border-primary/40 bg-surface px-3 text-[0.9375rem] font-medium text-ink shadow-card disabled:cursor-default"
            aria-label={`${step.tokens[tokenIndex]}（点击移回）`}
          >
            {step.tokens[tokenIndex]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" aria-label="可选的词">
        {available.map(({ token, index }) => (
          <button
            key={index}
            type="button"
            lang="en"
            disabled={locked}
            onClick={() => onDraft({ picked: [...draft.picked, index] })}
            className="h-10 rounded-xl border border-border bg-surface-soft px-3 text-[0.9375rem] text-ink transition-colors hover:border-primary/40 hover:bg-primary-soft disabled:cursor-default disabled:opacity-60"
          >
            {token}
          </button>
        ))}
      </div>
      {!locked && draft.picked.length > 0 ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => onDraft({ picked: [] })}>
            <RotateCcw aria-hidden="true" />
            重新排
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function orderDraftToTokens(step: StepOf<"order">, draft: OrderDraft): string[] {
  return draft.picked.map((i) => step.tokens[i]!);
}

// ------------------------------------------------------------------ match ----

export function MatchStepView({ step, draft, onDraft, evaluation }: AnswerStepProps<StepOf<"match">, MatchDraft>) {
  const baseId = useId();
  const locked = evaluation !== null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{step.instructions_zh}</h2>
      <ul className="flex flex-col gap-2">
        {step.lefts.map((left, i) => {
          const id = `${baseId}-${i}`;
          return (
            <li key={left} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor={id} lang={/[a-z]/i.test(left) ? "en" : undefined} className="font-medium text-ink">
                {left}
              </label>
              <select
                id={id}
                value={draft.selections[left] ?? ""}
                disabled={locked}
                onChange={(e) => onDraft({ selections: { ...draft.selections, [left]: e.target.value } })}
                className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.9375rem] text-ink sm:w-64 disabled:opacity-70"
              >
                <option value="">请选择…</option>
                {step.rights.map((right) => (
                  <option key={right} value={right}>
                    {right}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
