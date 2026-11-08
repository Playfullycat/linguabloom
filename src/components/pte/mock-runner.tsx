"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { finishMockAction, saveMockProgressAction, startMockAction } from "@/modules/pte/actions";
import type { MockState } from "@/modules/pte/services/mock";
import type { PracticeItem } from "@/modules/pte/services/pte";

import { PracticePlayer } from "./practice-player";

const SAVE_EVERY_MS = 15_000;

/**
 * Runs a mock test: one section clock for all items (it keeps running between
 * items and stops while the test is saved and closed), the current item in
 * mock mode (no answers shown until the end), progress saved regularly.
 */
export function MockRunner({ state, item, scoringRule, audioSource }: { state: MockState; item: PracticeItem; scoringRule: string; audioSource: "provider" | "browser" | "simulated" }) {
  const router = useRouter();
  const openedAt = useRef(0);
  const [elapsed, setElapsed] = useState(state.elapsedSeconds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ended = useRef(false);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const getElapsed = useCallback(() => state.elapsedSeconds + Math.floor((Date.now() - openedAt.current) / 1000), [state.elapsedSeconds]);

  // Section clock; saved every few seconds and when the time is up (which ends the test).
  useEffect(() => {
    let lastSave = Date.now();
    const t = window.setInterval(() => {
      const e = getElapsed();
      setElapsed(e);
      if (e >= state.timeLimitSeconds && !ended.current) {
        ended.current = true;
        void saveMockProgressAction(state.id, e).then(() => router.refresh());
      } else if (Date.now() - lastSave > SAVE_EVERY_MS) {
        lastSave = Date.now();
        void saveMockProgressAction(state.id, e);
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [getElapsed, state.id, state.timeLimitSeconds, router]);

  const remaining = Math.max(0, state.timeLimitSeconds - elapsed);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const index = state.currentIndex ?? 0;

  const pause = () =>
    startTransition(async () => {
      const r = await saveMockProgressAction(state.id, getElapsed());
      if (!r.ok) return setError(r.error);
      router.push("/pte");
    });

  const endNow = () =>
    startTransition(async () => {
      await saveMockProgressAction(state.id, getElapsed());
      const r = await finishMockAction(state.id);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span role="timer" data-testid="mock-timer" className={cn("rounded-full px-3 py-1 text-sm font-medium tabular-nums", remaining <= 60 ? "bg-coral-soft text-coral-ink" : "bg-surface-soft text-ink")}>
          本部分剩余 {clock(remaining)}
        </span>
        <span className="text-sm text-muted" data-testid="mock-progress">
          第 {index + 1} / {state.items.length} 题
        </span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={pause} disabled={pending}>
            <Pause aria-hidden="true" />
            保存，稍后继续
          </Button>
          <Button size="sm" variant="ghost" onClick={endNow} disabled={pending}>
            结束并看结果
          </Button>
        </span>
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label="题目进度">
        {state.items.map((it, i) => (
          <li key={it.promptId} className={cn("h-1.5 w-8 rounded-full", it.attemptId ? "bg-primary" : i === index ? "bg-primary/40" : "bg-surface-soft")} aria-label={`第 ${i + 1} 题${it.attemptId ? "已答" : ""}`} />
        ))}
      </ol>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <PracticePlayer key={item.promptId} item={item} scoringRule={scoringRule} audioSource={audioSource} nextHref={null} mock={{ id: state.id, getElapsed, onDone: () => router.refresh() }} />
      <p className="text-xs text-muted">模拟练习中不显示每题的答案；全部做完（或时间到）后一起看结果。离开页面前点“保存，稍后继续”，计时会暂停。</p>
    </div>
  );
}

/** Start a mock test for a section (or continue the one in progress). */
export function StartMockButton({ section, label, inProgress }: { section: string; label: string; inProgress: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={inProgress ? "primary" : "outline"}
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await startMockAction(section);
            if (!r.ok) return setError(r.error);
            router.push(`/pte/mock/${r.data.id}`);
          })
        }
      >
        <Play aria-hidden="true" />
        {inProgress ? `继续：${label}` : label}
      </Button>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
