"use client";

import { CheckCircle2, CircleAlert, Eye, Headphones, Lightbulb, LoaderCircle, PartyPopper, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { speak, useSpeechRate } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";
import { answerReviewAction } from "@/modules/review/actions";
import { CARD_TYPE_INFO, RATING, isTypedAnswerCorrect, isTypedCard, type Grade } from "@/modules/review/domain/cards";
import type { ClientReviewCard } from "@/modules/review/services/review";

import { ReviewRatingBar } from "./review-rating-bar";

/** Re-show a card later in this session if FSRS schedules it within this window (learning steps). */
const REQUEUE_WITHIN_MS = 20 * 60_000;

type Phase =
  | { kind: "front" }
  | { kind: "revealed" } // self-rated cards
  | { kind: "checked"; correct: boolean; retried: boolean }; // typed cards

export function ReviewSession({ initialCards }: { initialCards: ClientReviewCard[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialCards);
  const [phase, setPhase] = useState<Phase>({ kind: "front" });
  const [typed, setTyped] = useState("");
  const [firstTyped, setFirstTyped] = useState("");
  const [hintUsed, setHintUsed] = useState(false);
  const [overridden, setOverridden] = useState(false);
  /** Result of the optional immediate retry after a wrong answer (never submitted). */
  const [retryCorrect, setRetryCorrect] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState({ reviewed: 0, again: 0 });
  const [rate] = useSpeechRate();
  const shownAt = useRef(0);
  const requestIds = useRef<Record<string, string>>({});
  const inputId = useId();

  const card = queue[0];
  const total = done.reviewed + queue.length;

  // Reset per card; auto-play for listening/spelling cards.
  useEffect(() => {
    if (!card) return;
    shownAt.current = Date.now();
    if (card.cardType === "listening" || card.cardType === "spelling") void speak(card.spoken, rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the card changes
  }, [card?.id, queue.length]);

  const resetCardState = () => {
    setPhase({ kind: "front" });
    setTyped("");
    setFirstTyped("");
    setHintUsed(false);
    setOverridden(false);
    setRetryCorrect(null);
    setError(null);
  };

  const submit = useCallback(
    async (rating: Grade) => {
      if (!card || submitting) return;
      setSubmitting(true);
      setError(null);
      const requestId = (requestIds.current[card.id] ??= crypto.randomUUID());
      try {
        const outcome = await answerReviewAction({
          cardId: card.id,
          rating,
          clientRequestId: requestId,
          elapsedMs: Math.min(3_600_000, Date.now() - shownAt.current),
          typed: isTypedCard(card.cardType) ? firstTyped : undefined,
          overridden: overridden || undefined,
          hintUsed: hintUsed || undefined,
        });
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        delete requestIds.current[card.id];
        const { result } = outcome;
        const requeue = new Date(result.dueAt).getTime() - Date.now() < REQUEUE_WITHIN_MS;
        setDone((d) => ({ reviewed: d.reviewed + 1, again: d.again + (result.rating === RATING.Again ? 1 : 0) }));
        setQueue((q) => {
          const [current, ...rest] = q;
          return requeue && current ? [...rest, { ...current, isNew: false }] : rest;
        });
        resetCardState();
      } catch {
        setError("网络好像断了，这张卡还没有保存。请再点一次。");
      } finally {
        setSubmitting(false);
      }
    },
    [card, firstTyped, hintUsed, overridden, submitting],
  );

  const check = () => {
    if (!card || !typed.trim()) return;
    const correct = isTypedAnswerCorrect({ text: card.text, exampleEn: card.exampleEn }, card.cardType, typed);
    if (phase.kind === "front") {
      setFirstTyped(typed);
      setPhase({ kind: "checked", correct, retried: false });
    } else if (phase.kind === "checked") {
      setPhase({ kind: "checked", correct: phase.correct, retried: true });
      setRetryCorrect(correct);
    }
  };

  // Keyboard: Enter reveals/checks, 1–4 rate (when rating is possible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || submitting || e.target instanceof HTMLTextAreaElement) return;
      const inInput = e.target instanceof HTMLInputElement;
      if (phase.kind === "revealed" && !inInput && ["1", "2", "3", "4"].includes(e.key)) submit(Number(e.key) as Grade);
      if (phase.kind === "front" && !isTypedCard(card.cardType) && (e.key === "Enter" || e.key === " ") && !inInput) {
        e.preventDefault();
        setPhase({ kind: "revealed" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, phase, submit, submitting]);

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-8 text-center shadow-card">
        <PartyPopper className="size-10 text-mint-ink" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">这一轮复习完成了</h2>
          <p className="text-sm text-muted">
            复习了 {done.reviewed} 次{done.again > 0 ? `，其中 ${done.again} 次没想起来，它们会很快再出现` : ""}。
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => router.refresh()}>
            <RotateCcw aria-hidden="true" />
            看看还有没有到期的
          </Button>
          <Button asChild>
            <Link href="/learn/path">继续学课程</Link>
          </Button>
        </div>
      </div>
    );
  }

  const info = CARD_TYPE_INFO[card.cardType];
  const typedCard = isTypedCard(card.cardType);
  const showBack = phase.kind !== "front";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ProgressBar value={total > 0 ? done.reviewed / total : 0} label={`已复习 ${done.reviewed}，剩余 ${queue.length}`} />
        <span className="shrink-0 text-xs tabular-nums text-muted">
          剩余 {queue.length}
        </span>
      </div>

      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-card sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={info.knowledge === "receptive" ? "blue" : "primary"} size="sm">
            {info.label}
          </Badge>
          {card.isNew ? (
            <Badge tone="yellow" size="sm">
              新词
            </Badge>
          ) : null}
          <span className="text-xs text-muted">{info.description}</span>
        </div>

        {/* Front */}
        <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-center">
          {card.cardType === "recognition" ? (
            <>
              <p lang="en" className="text-3xl font-semibold text-ink sm:text-4xl">{card.text}</p>
              <div className="flex items-center gap-1 text-muted">
                {card.ipa ? <span className="font-ipa">{card.ipa}</span> : null}
                <SpeakButton text={card.spoken} />
              </div>
            </>
          ) : null}
          {card.cardType === "listening" || card.cardType === "spelling" ? (
            <Button variant="soft" size="lg" onClick={() => speak(card.spoken, rate)}>
              <Headphones aria-hidden="true" />
              再听一遍
            </Button>
          ) : null}
          {card.cardType === "recall" ? (
            <>
              <p className="text-2xl font-semibold text-ink sm:text-3xl">{card.zh}</p>
              <p className="text-sm text-muted">例句意思：{card.exampleZh}</p>
            </>
          ) : null}
          {card.cardType === "cloze" && card.cloze ? (
            <>
              <p lang="en" className="text-2xl font-medium text-ink">{card.cloze.sentence}</p>
              <p className="text-sm text-muted">{card.exampleZh}</p>
            </>
          ) : null}
        </div>

        {/* Typed answer */}
        {typedCard ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
          >
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              {card.cardType === "spelling" ? "写出你听到的词或短语" : "写出英文"}
            </label>
            <div className="flex gap-2">
              <Input
                id={inputId}
                lang="en"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                value={typed}
                disabled={phase.kind === "checked" && (phase.correct || overridden)}
                onChange={(e) => setTyped(e.target.value)}
              />
              {phase.kind === "front" || (phase.kind === "checked" && !phase.correct && !overridden) ? (
                <Button type="submit" disabled={!typed.trim()}>
                  检查
                </Button>
              ) : null}
            </div>
            {phase.kind === "front" && !hintUsed ? (
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setHintUsed(true)}>
                  <Lightbulb aria-hidden="true" />
                  提示（会记为“很吃力”）
                </Button>
              </div>
            ) : null}
            {hintUsed && phase.kind === "front" ? (
              <p className="text-sm text-yellow-ink">
                提示：以 <span lang="en" className="font-semibold">{card.spoken.slice(0, 1)}</span> 开头，共 {card.spoken.split(" ").length} 个词
              </p>
            ) : null}
          </form>
        ) : null}

        {/* Back */}
        {showBack ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span lang="en" className="text-xl font-semibold text-ink">{card.text}</span>
              {card.ipa ? <span className="font-ipa text-sm text-muted">{card.ipa}</span> : null}
              <SpeakButton text={card.spoken} />
            </div>
            <p className="text-ink">{card.zh}</p>
            <p className="flex items-center gap-1 text-sm">
              <SpeakButton text={card.exampleEn} label={`朗读例句：${card.exampleEn}`} className="-ml-2" />
              <span className="flex flex-col">
                <span lang="en" className="text-ink">{card.exampleEn}</span>
                <span className="text-muted">{card.exampleZh}</span>
              </span>
            </p>
          </div>
        ) : null}

        {/* Typed feedback */}
        {phase.kind === "checked" ? (
          <div aria-live="polite">
            {phase.correct || overridden ? (
              <p className="flex items-center gap-2 font-medium text-mint-ink">
                <CheckCircle2 className="size-5" aria-hidden="true" />
                {overridden ? "好的，按答对处理。" : "答对了！"}
                {hintUsed ? <span className="text-sm font-normal text-muted">用了提示，记为“很吃力”。</span> : null}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-2 font-medium text-coral-ink">
                  <CircleAlert className="size-5" aria-hidden="true" />
                  还不太对。正确答案在上面，可以马上再写一次（不计入成绩）。
                </p>
                {phase.retried && retryCorrect !== null ? (
                  <p className={cn("text-sm", retryCorrect ? "text-mint-ink" : "text-coral-ink")}>
                    {retryCorrect ? "这次写对了，很好。它会很快再出现，帮你巩固。" : "还是不太对，没关系，它很快会再出现。"}
                  </p>
                ) : null}
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOverridden(true)}>
                    我的答案其实也对（比如另一种说法）
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {phase.kind === "front" && !typedCard ? (
            <Button size="lg" onClick={() => setPhase({ kind: "revealed" })}>
              <Eye aria-hidden="true" />
              想好了，看答案
            </Button>
          ) : null}
          {phase.kind === "revealed" ? (
            <ReviewRatingBar grades={[1, 2, 3, 4]} onRate={submit} disabled={submitting} />
          ) : null}
          {phase.kind === "checked" && (phase.correct || overridden) ? (
            hintUsed ? (
              <Button size="lg" onClick={() => submit(RATING.Hard)} disabled={submitting}>
                继续（记为“很吃力”）
              </Button>
            ) : (
              <ReviewRatingBar grades={[2, 3, 4]} onRate={submit} disabled={submitting} />
            )
          ) : null}
          {phase.kind === "checked" && !phase.correct && !overridden ? (
            <Button size="lg" variant="outline" onClick={() => submit(RATING.Again)} disabled={submitting}>
              继续（记为“忘记了”）
            </Button>
          ) : null}
          {submitting ? (
            <p className="flex items-center justify-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              正在保存…
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-center text-xs text-muted">快捷键：Enter 看答案 / 检查，1–4 评分。评分只影响下次出现的时间，不是考试成绩。</p>
    </div>
  );
}
