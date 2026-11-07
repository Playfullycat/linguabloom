"use client";

import { MessageCircle } from "lucide-react";
import { useId } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { VoiceRecorder } from "@/components/media/voice-recorder";
import { cn } from "@/lib/utils";

import type { AnswerStepProps, OpenDraft, StepOf } from "./types";

type OpenStep = StepOf<"speak"> | StepOf<"write">;

/**
 * Open output tasks (spec §2.6): do the task first (speak or write), then
 * compare with model answers and tick a short self-check. No AI scoring in
 * Phase 1 — the result is a self-assessment, recorded as such.
 */
export function OpenStepView({ step, draft, onDraft, evaluation }: AnswerStepProps<OpenStep, OpenDraft>) {
  const textId = useId();
  const isSpeak = step.type === "speak";
  const reviewing = draft.phase === "reviewing" || evaluation !== null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{isSpeak ? "开口说" : "动手写"}</h2>
      <p className="text-[0.9375rem] leading-relaxed text-ink">{step.task_zh}</p>

      {step.type === "speak" && step.prompt_en ? (
        <div className="flex items-center gap-2 rounded-2xl bg-blue-soft px-4 py-3 text-blue-ink">
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-sm">对方说：</span>
          <span lang="en" className="font-medium">{step.prompt_en}</span>
          <SpeakButton text={step.prompt_en} />
        </div>
      ) : null}

      {isSpeak ? (
        <VoiceRecorder onRecorded={(hasRecording) => onDraft({ ...draft, hasRecording })} />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={textId} className="text-sm font-medium text-ink">
          {isSpeak ? "或者把你要说的话打出来（可选，录了音也可以不写）" : "你的回答"}
        </label>
        <textarea
          id={textId}
          lang="en"
          rows={isSpeak ? 2 : 3}
          value={draft.text}
          disabled={evaluation !== null}
          onChange={(e) => onDraft({ ...draft, text: e.target.value })}
          className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-70"
        />
      </div>

      {reviewing ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-mint/40 bg-mint-soft/60 p-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-mint-ink">示范说法（只是参考，意思对就好）</h3>
            <ul className="flex flex-col gap-1.5">
              {step.model_answers.map((answer) => (
                <li key={answer} className="flex items-center gap-1">
                  <SpeakButton text={answer} />
                  <span lang="en" className="text-[0.9375rem] text-ink">{answer}</span>
                </li>
              ))}
            </ul>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-mint-ink">对照检查：你做到了哪些？</legend>
            {step.checklist_zh.map((item, i) => {
              const checked = draft.checked.includes(i);
              return (
                <label key={item} className={cn("flex items-start gap-2.5 text-sm text-ink", evaluation === null && "cursor-pointer")}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={checked}
                    disabled={evaluation !== null}
                    onChange={() =>
                      onDraft({ ...draft, checked: checked ? draft.checked.filter((c) => c !== i) : [...draft.checked, i] })
                    }
                  />
                  {item}
                </label>
              );
            })}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
