"use client";

import { ArrowRight, Eye, EyeOff, Loader2, Mic, PhoneOff, RotateCcw, Square, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { endSpeakingAction } from "@/modules/speaking/actions";
import type { Comparison } from "@/modules/speaking/domain/compare";

import { useTeacherVoice, useTurnRecorder } from "./use-voice";

type Props = {
  attemptId: string;
  type: "read_aloud" | "repeat_sentence";
  items: string[];
  providerSpeech: boolean;
};

type Result = { heard: string; comparison: Comparison };

/**
 * Read aloud / repeat: one sentence at a time, recorded and transcribed, then
 * compared word by word with the sentence. The check shows what the
 * transcriber recognised — it is not a pronunciation score.
 */
export function ScriptedSession({ attemptId, type, items, providerSpeech }: Props) {
  const router = useRouter();
  const voice = useTeacherVoice(providerSpeech);
  const recorder = useTurnRecorder(30);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<(Result | null)[]>(() => items.map(() => null));
  const [showText, setShowText] = useState(type === "read_aloud");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const turns = useRef<{ role: "learner"; text: string; item: number }[]>([]);

  const sentence = items[index]!;
  const result = results[index];
  const done = results.every(Boolean);

  const record = async () => {
    voice.stop();
    setError(null);
    const r = await recorder.record();
    if (!r) return;
    if (r.seconds < 0.5 || r.blob.size < 300) {
      setError("录音太短了，按下按钮后再开始读。");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("audio", r.blob, "item.webm");
    form.append("item", String(index));
    form.append("history", "[]");
    try {
      const res = await fetch(`/api/speaking/${attemptId}/turn`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
      const body = (await res.json().catch(() => null)) as { error?: string; learnerText: string; silent: boolean; comparison: Comparison | null } | null;
      if (!res.ok || !body) return setError(body?.error ?? "这一句没有成功，请再试一次。");
      if (body.silent || !body.comparison) return setError("没听清，请靠近麦克风再读一次。");
      turns.current.push({ role: "learner", text: body.learnerText, item: index });
      setResults((rs) => rs.map((x, i) => (i === index ? { heard: body.learnerText, comparison: body.comparison! } : x)));
      if (type === "repeat_sentence") setShowText(true);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "TimeoutError" ? "等了太久没有回应（超时），请再试一次。" : "连不上服务器，请检查网络后再试。");
    } finally {
      setBusy(false);
    }
  };

  const go = (i: number) => {
    voice.stop();
    setError(null);
    setIndex(i);
    setShowText(type === "read_aloud" || results[i] !== null);
  };

  const finish = async () => {
    setEnding(true);
    voice.stop();
    const r = await endSpeakingAction({ id: attemptId, reason: done ? "completed" : "user", durationSeconds: Math.round((Date.now() - startedAt.current) / 1000), turns: turns.current });
    if (!r.ok) {
      setError(r.error);
      setEnding(false);
      return;
    }
    router.push(`/speaking/attempts/${attemptId}${r.data.feedbackError ? `?feedback=${encodeURIComponent(r.data.feedbackError)}` : ""}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="句子">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => go(i)}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "size-9 rounded-full border text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring",
              i === index ? "border-primary bg-primary text-primary-foreground" : results[i] ? "border-mint bg-mint-soft text-mint-ink" : "border-border bg-surface text-muted",
            )}
          >
            {i + 1}
          </button>
        ))}
        <span className="text-xs text-muted">标准语音模式：录一句、转写一句</span>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="soft" onClick={() => void voice.play(sentence, true)} disabled={voice.playing || voice.source === "none"}>
            <Volume2 aria-hidden="true" />
            {voice.playing ? "正在播放…" : "听一遍"}
          </Button>
          {type === "repeat_sentence" ? (
            <Button size="sm" variant="ghost" onClick={() => setShowText((v) => !v)}>
              {showText ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {showText ? "隐藏文字" : "显示文字"}
            </Button>
          ) : null}
          {voice.source === "browser" ? <span className="text-xs text-muted">浏览器朗读</span> : null}
        </div>
        {showText ? (
          result ? (
            <p lang="en" className="text-lg leading-relaxed" data-testid="compared-sentence">
              {result.comparison.words.map((w, i) => (
                <span key={i} className={cn(!w.heard && "rounded bg-coral-soft px-0.5 text-coral-ink underline decoration-dotted")}>
                  {w.text}
                  {i < result.comparison.words.length - 1 ? " " : ""}
                </span>
              ))}
            </p>
          ) : (
            <p lang="en" className="text-lg leading-relaxed text-ink">
              {sentence}
            </p>
          )
        ) : (
          <p className="text-sm text-muted">先听，不看文字，再复述。</p>
        )}
        {result ? (
          <div className="flex flex-col gap-1 text-sm">
            <span data-testid="item-score">
              识别出 {result.comparison.heard} / {result.comparison.total} 个词
            </span>
            <span className="text-muted">
              转写结果：<span lang="en">{result.heard}</span>
            </span>
            <span className="text-xs text-muted">标出的词没有被识别到——可能是漏读，也可能是转写没听清。这不是发音评分，口音不同不算错。</span>
          </div>
        ) : null}
      </div>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {recorder.error ? <FormMessage tone="error">{recorder.error}</FormMessage> : null}

      <div className="flex flex-wrap gap-2">
        {recorder.phase === "recording" ? (
          <Button variant="danger" onClick={recorder.stop}>
            <Square aria-hidden="true" />
            读完了（{recorder.elapsed}s）
          </Button>
        ) : (
          <Button onClick={() => void record()} disabled={busy || recorder.phase === "requesting"}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : result ? <RotateCcw aria-hidden="true" /> : <Mic aria-hidden="true" />}
            {busy ? "正在转写…" : recorder.phase === "requesting" ? "正在打开麦克风…" : result ? "再读一次" : "开始录音"}
          </Button>
        )}
        {index < items.length - 1 ? (
          <Button variant="outline" onClick={() => go(index + 1)} disabled={busy || recorder.phase === "recording"}>
            下一句
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
        <Button variant={done ? "primary" : "ghost"} onClick={() => void finish()} disabled={ending || busy || recorder.phase === "recording" || !results.some(Boolean)}>
          {ending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}
          {ending ? "正在生成反馈…" : done ? "完成，查看反馈" : "结束练习"}
        </Button>
      </div>
    </div>
  );
}
