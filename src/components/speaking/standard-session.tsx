"use client";

import { Keyboard, Loader2, Mic, PhoneOff, Send, Square, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { endSpeakingAction } from "@/modules/speaking/actions";

import { TurnList, type TurnView } from "./turn-list";
import { useTeacherVoice, useTurnRecorder } from "./use-voice";

type Props = {
  attemptId: string;
  /** "standard": record each turn (标准语音模式). "typed": no microphone. */
  mode: "standard" | "typed";
  opening: string;
  providerSpeech: boolean;
};

type Turn = { id: string; role: "learner" | "ai"; text: string; note?: string };

const TURN_TIMEOUT_MS = 45_000;

/**
 * Chained voice mode (spec §5.10 fallback): record → transcribe → the
 * teacher's reply (text) → speech. Every request has a timeout, so a slow or
 * broken service shows a reason instead of loading forever. Typing is always
 * available as the last fallback.
 */
export function StandardSession({ attemptId, mode, opening, providerSpeech }: Props) {
  const router = useRouter();
  const voice = useTeacherVoice(providerSpeech);
  const recorder = useTurnRecorder(60);
  const [turns, setTurns] = useState<Turn[]>([{ id: "opening", role: "ai", text: opening }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(mode === "typed");
  const [draft, setDraft] = useState("");
  const [finished, setFinished] = useState(false);
  const [ending, setEnding] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const seq = useRef(0);
  const { play } = voice;

  // The teacher reads the opening line once.
  useEffect(() => {
    if (mode === "standard") void play(opening);
  }, [mode, opening, play]);

  const history = () => turns.filter((t) => t.id !== "opening").map((t) => ({ role: t.role, text: t.text }));

  const send = async (part: { audio?: Blob; text?: string }) => {
    setBusy(true);
    setError(null);
    voice.stop();
    const form = new FormData();
    if (part.audio) form.append("audio", part.audio, "turn.webm");
    if (part.text) form.append("text", part.text);
    form.append("history", JSON.stringify(history()));
    try {
      const res = await fetch(`/api/speaking/${attemptId}/turn`, { method: "POST", body: form, signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        learnerText: string;
        silent: boolean;
        aiText: string | null;
        replyError: string | null;
        final: boolean;
      } | null;
      if (!res.ok || !body) {
        setError(body?.error ?? "这一轮没有成功，请再试一次。");
        return;
      }
      if (body.silent) {
        setError("没听清你说的话，请靠近麦克风再说一次。");
        return;
      }
      const next: Turn[] = [{ id: `l${++seq.current}`, role: "learner", text: body.learnerText }];
      if (body.aiText) next.push({ id: `a${seq.current}`, role: "ai", text: body.aiText });
      setTurns((t) => [...t, ...next]);
      if (body.replyError) setError(`你的这句话已经记下了，但老师这次没能回复：${body.replyError}`);
      if (body.final) setFinished(true);
      if (body.aiText && !typing) void voice.play(body.aiText);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "TimeoutError" ? "等了太久没有回应（超时）。你的录音没有丢，可以再说一次，或者改用文字回答。" : "连不上服务器，请检查网络后再试。");
    } finally {
      setBusy(false);
    }
  };

  const onRecord = async () => {
    voice.stop();
    const r = await recorder.record();
    if (!r) return;
    if (r.seconds < 0.5 || r.blob.size < 300) {
      setError("录音太短了，按下按钮后再开始说。");
      return;
    }
    await send({ audio: r.blob });
  };

  const finish = async () => {
    setEnding(true);
    voice.stop();
    recorder.stop();
    const r = await endSpeakingAction({
      id: attemptId,
      reason: finished ? "completed" : "user",
      durationSeconds: Math.round((Date.now() - startedAt.current) / 1000),
      turns: turns.map((t) => ({ role: t.role, text: t.text })),
    });
    if (!r.ok) {
      setError(r.error);
      setEnding(false);
      return;
    }
    router.push(`/speaking/attempts/${attemptId}${r.data.feedbackError ? `?feedback=${encodeURIComponent(r.data.feedbackError)}` : ""}`);
  };

  const phase = recorder.phase === "recording" ? "recording" : busy ? "thinking" : voice.playing ? "speaking" : finished ? "done" : "ready";
  const label = { recording: `正在录音 ${recorder.elapsed}s / ${recorder.maxSeconds}s`, thinking: typing ? "老师在想…" : "正在转写和思考…", speaking: "老师在说话", done: "练习完成", ready: typing ? "轮到你了（文字）" : "轮到你了：按下按钮再说" }[phase];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" aria-live="polite" data-testid="voice-phase" data-phase={phase} className="inline-flex items-center gap-2 rounded-full bg-surface-soft px-3 py-1.5 text-sm font-medium text-ink">
          {phase === "thinking" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {phase === "recording" ? <span className="size-2 animate-pulse rounded-full bg-coral" aria-hidden="true" /> : null}
          {phase === "speaking" ? <Volume2 className="size-4" aria-hidden="true" /> : null}
          {label}
        </span>
        <span className="text-xs text-muted">
          {mode === "typed" ? "文字回答" : "标准语音模式：每次说完按停止，再转写和回复（不是实时对话）"}
          {voice.source === "browser" && !typing ? " · 老师的声音由浏览器朗读" : ""}
        </span>
      </div>

      <TurnList turns={turns as TurnView[]} emptyText="" />

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {recorder.error ? <FormMessage tone="error">{recorder.error}</FormMessage> : null}

      {!finished ? (
        typing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text || busy) return;
              setDraft("");
              void send({ text });
            }}
          >
            <textarea
              aria-label="你的回答"
              lang="en"
              rows={2}
              maxLength={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-[0.9375rem]"
              placeholder="用英语写下你想说的话"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !draft.trim()}>
                <Send aria-hidden="true" />
                发送
              </Button>
              {mode === "standard" ? (
                <Button type="button" variant="ghost" onClick={() => setTyping(false)}>
                  <Mic aria-hidden="true" />
                  改回录音
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recorder.phase === "recording" ? (
              <Button variant="danger" onClick={recorder.stop}>
                <Square aria-hidden="true" />
                说完了
              </Button>
            ) : (
              <Button onClick={() => void onRecord()} disabled={busy || recorder.phase === "requesting"}>
                <Mic aria-hidden="true" />
                {recorder.phase === "requesting" ? "正在打开麦克风…" : "按下开始说"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setTyping(true)} disabled={recorder.phase === "recording"}>
              <Keyboard aria-hidden="true" />
              改用文字回答
            </Button>
          </div>
        )
      ) : (
        <p className="text-sm text-ink">老师已经结束了这次练习，点「结束练习」查看反馈。</p>
      )}

      <div>
        <Button variant={finished ? "primary" : "outline"} onClick={() => void finish()} disabled={ending || busy || recorder.phase === "recording"}>
          {ending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}
          {ending ? "正在结束，生成反馈…" : "结束练习"}
        </Button>
      </div>
    </div>
  );
}
