"use client";

import { Eye, EyeOff, Lightbulb, Play, Square } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Button } from "@/components/ui/button";
import { speak, stopSpeaking, useSpeechRate, isSpeechSupported } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";
import type { VocabularyItem } from "@/modules/curriculum/content/schema";

import type { StepOf } from "./types";

export function OrientationView({ step }: { step: StepOf<"orientation"> }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-ink">{step.title_zh}</h2>
      <p className="text-[0.9375rem] leading-relaxed text-ink">{step.body_zh}</p>
    </div>
  );
}

/** Listen first (spec §2.5): English and Chinese text are hidden until revealed. */
export function DialogueView({ step }: { step: StepOf<"dialogue"> }) {
  const [showEnglish, setShowEnglish] = useState(false);
  const [showChinese, setShowChinese] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const runRef = useRef(0);
  const [rate] = useSpeechRate();

  const playAll = async () => {
    if (!isSpeechSupported()) return;
    const run = ++runRef.current;
    setPlayingAll(true);
    for (const line of step.lines) {
      if (run !== runRef.current) return;
      await speak(line.en, rate);
      await new Promise((r) => setTimeout(r, 350));
    }
    if (run === runRef.current) setPlayingAll(false);
  };

  const stopAll = () => {
    runRef.current++;
    stopSpeaking();
    setPlayingAll(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 lang="en" className="text-xl font-semibold text-ink">{step.title_en}</h2>
        {step.scene_zh ? <p className="text-sm text-muted">{step.scene_zh}</p> : null}
      </div>
      <p className="rounded-xl bg-blue-soft px-4 py-3 text-sm text-blue-ink">{step.instructions_zh}</p>
      <div className="flex flex-wrap gap-2">
        {playingAll ? (
          <Button onClick={stopAll} variant="outline">
            <Square aria-hidden="true" />
            停止
          </Button>
        ) : (
          <Button onClick={playAll}>
            <Play aria-hidden="true" />
            播放整段对话
          </Button>
        )}
        <Button variant="ghost" onClick={() => setShowEnglish((v) => !v)} aria-pressed={showEnglish}>
          {showEnglish ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {showEnglish ? "隐藏英文" : "显示英文"}
        </Button>
        <Button variant="ghost" onClick={() => setShowChinese((v) => !v)} aria-pressed={showChinese}>
          {showChinese ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {showChinese ? "隐藏中文" : "显示中文"}
        </Button>
      </div>
      <ol className="flex flex-col gap-2">
        {step.lines.map((line, i) => (
          <li key={i} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3">
            <SpeakButton text={line.en} label={`朗读第 ${i + 1} 句`} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-semibold text-muted">{line.speaker}</span>
              {showEnglish ? (
                <span lang="en" className="text-[0.9375rem] font-medium text-ink">{line.en}</span>
              ) : (
                <span className="text-sm text-muted italic">（先听，再决定要不要看文字）</span>
              )}
              {showChinese ? <span className="text-sm text-muted">{line.zh}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function VocabView({ step, vocabulary }: { step: StepOf<"vocab">; vocabulary: VocabularyItem[] }) {
  const items = step.items.map((key) => vocabulary.find((v) => v.key === key)).filter((v): v is VocabularyItem => Boolean(v));
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-ink">新词和短语</h2>
      <p className="text-sm text-muted">{step.instructions_zh}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex gap-2 rounded-2xl border border-border bg-surface p-3">
            <SpeakButton text={item.text.split(" / ")[0]!} label={`朗读：${item.text}`} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span lang="en" className="font-semibold text-ink">{item.text}</span>
                {item.ipa ? <span className="font-ipa text-xs text-muted">{item.ipa}</span> : null}
              </span>
              <span className="text-sm text-ink">{item.zh}</span>
              <span className="mt-1 flex items-center gap-1">
                <SpeakButton text={item.example_en} label={`朗读例句：${item.example_en}`} className="-ml-2 size-7" />
                <span className="flex flex-col">
                  <span lang="en" className="text-xs text-ink">{item.example_en}</span>
                  <span className="text-xs text-muted">{item.example_zh}</span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Highlighted({ text, highlight }: { text: string; highlight: string[] }) {
  if (highlight.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${highlight.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        highlight.includes(part) ? (
          <mark key={i} className="rounded bg-yellow-soft px-0.5 font-semibold text-yellow-ink">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Notice first, then reveal the rule (guided discovery). */
export function NoticeView({ step }: { step: StepOf<"notice"> }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-ink">观察一下</h2>
      <p className="text-[0.9375rem] text-ink">{step.question_zh}</p>
      <ul className="flex flex-col gap-2">
        {step.examples.map((ex) => (
          <li key={ex.en} className="flex items-start gap-2 rounded-2xl border border-border bg-surface p-3">
            <SpeakButton text={ex.en.replace(/\s*\(.*\)\s*$/, "")} label={`朗读：${ex.en}`} />
            <span className="flex flex-col">
              <span lang="en" className="font-medium text-ink">
                <Highlighted text={ex.en} highlight={ex.highlight} />
              </span>
              <span className="text-sm text-muted">{ex.zh}</span>
            </span>
          </li>
        ))}
      </ul>
      {revealed ? (
        <p role="status" className="flex gap-2 rounded-xl bg-mint-soft px-4 py-3 text-sm text-mint-ink">
          <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {step.takeaway_zh}
        </p>
      ) : (
        <div>
          <Button variant="soft" onClick={() => setRevealed(true)}>
            <Lightbulb aria-hidden="true" />
            我想好了，看看规律
          </Button>
        </div>
      )}
    </div>
  );
}

export function TeachView({ step }: { step: StepOf<"teach"> }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-ink">{step.title_zh}</h2>
      <p className="text-[0.9375rem] leading-relaxed text-ink">{step.explanation_zh}</p>
      {step.pattern ? (
        <p lang="en" className="rounded-xl bg-primary-soft px-4 py-3 font-medium whitespace-pre-line text-primary-ink">
          {step.pattern}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {step.examples.map((ex) => (
          <li key={ex.en} className="flex items-start gap-2">
            <SpeakButton text={ex.en} />
            <span className="flex flex-col">
              <span lang="en" className="font-medium text-ink">{ex.en}</span>
              <span className="text-sm text-muted">{ex.zh}</span>
            </span>
          </li>
        ))}
      </ul>
      {step.tips_zh.length > 0 ? (
        <ul className={cn("flex flex-col gap-1.5 rounded-xl border border-border bg-surface-soft/60 px-4 py-3 text-sm text-ink")}>
          {step.tips_zh.map((tip) => (
            <li key={tip} className="flex gap-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-yellow-ink" aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
