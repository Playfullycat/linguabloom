"use client";

import { Hand, Loader2, Mic, PhoneOff, RotateCcw, Send, Unplug, Volume2, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { closeSpeakingAction, endSpeakingAction } from "@/modules/speaking/actions";
import { PHASE_LABELS, finalTurns, initialVoiceState, voiceReducer, type VoiceEvent, type VoicePhase } from "@/modules/speaking/domain/voice-session";

import { TurnList } from "./turn-list";
import { ConnectError, connectSimulated, connectWebRTC, openMicrophone, stopStream, type VoiceTransport } from "./voice-transport";

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RECONNECTS = 2;

type Props = {
  attemptId: string;
  transport: "webrtc" | "simulated";
  opening: string;
  maxSeconds: number;
  saveAudio: boolean;
  /** Switch to the standard (recorded) mode after a failure. */
  onFallback: () => void;
};

const reducer = (state: typeof initialVoiceState, event: VoiceEvent) => voiceReducer(state, event);

const PHASE_STYLE: Record<VoicePhase, string> = {
  idle: "bg-surface-soft text-muted",
  connecting: "bg-yellow-soft text-yellow-ink",
  listening: "bg-mint-soft text-mint-ink",
  thinking: "bg-blue-soft text-blue-ink",
  speaking: "bg-primary-soft text-primary-ink",
  ended: "bg-surface-soft text-muted",
  failed: "bg-coral-soft text-coral-ink",
};

/**
 * Live conversation (spec §5.10): connecting → listening / thinking /
 * speaking → ended. The learner can interrupt the teacher (or just start
 * talking). A dropped connection never leaves an endless spinner: it shows
 * why and offers reconnect, the standard mode, or ending with feedback.
 * The microphone is released on every way out.
 */
export function RealtimeSession({ attemptId, transport, opening, maxSeconds, saveAudio, onFallback }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialVoiceState);
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [reconnects, setReconnects] = useState(0);
  const [simText, setSimText] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const transportRef = useRef<VoiceTransport | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [micOn, setMicOn] = useState(false);

  const release = useCallback(() => {
    transportRef.current?.close();
    transportRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream(streamRef.current);
    streamRef.current = null;
    setMicOn(false);
  }, []);

  const connect = useCallback(async () => {
    dispatch({ type: "local.connecting" });
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), CONNECT_TIMEOUT_MS);
    try {
      if (!streamRef.current) {
        streamRef.current = await openMicrophone();
        setMicOn(true);
        // Only the first connection is recorded (a recording can't be resumed cleanly after a reconnect).
        if (saveAudio && typeof MediaRecorder !== "undefined" && !recorderRef.current) {
          // Only the learner's own microphone is recorded, and only with consent.
          const rec = new MediaRecorder(streamRef.current);
          rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
          rec.start(1000);
          recorderRef.current = rec;
        }
      }
      const handlers = {
        onEvent: (e: VoiceEvent) => dispatch(e),
        onState: (s: "open" | "failed" | "closed") => {
          if (s === "open") {
            startedAtRef.current ??= Date.now();
            dispatch({ type: "local.connected" });
          }
          if (s === "failed") dispatch({ type: "local.failed", message: "连接中断了（网络不稳定或服务端断开）。" });
        },
      };
      transportRef.current =
        transport === "webrtc"
          ? await connectWebRTC({ attemptId, stream: streamRef.current, audio: audioRef.current!, signal: timeout.signal, ...handlers })
          : await connectSimulated({ attemptId, opening, signal: timeout.signal, ...handlers });
      // Opened but the data channel never came up: don't wait forever.
      window.setTimeout(() => {
        if (stateRef.current.phase === "connecting") {
          transportRef.current?.close();
          dispatch({ type: "local.failed", message: "连接超时了。" });
        }
      }, CONNECT_TIMEOUT_MS);
    } catch (error) {
      stopStream(streamRef.current);
      setMicOn(false);
      streamRef.current = null;
      dispatch({ type: "local.failed", message: error instanceof ConnectError ? error.message : "实时语音连接失败。" });
    } finally {
      window.clearTimeout(timer);
    }
  }, [attemptId, transport, opening, saveAudio]);

  // Connect once; leaving the page releases everything. If the page is shown
  // again (kept alive in the background), don't silently reconnect.
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (connectedOnce.current) dispatch({ type: "local.failed", message: "离开页面后，实时连接已经断开。" });
    else {
      connectedOnce.current = true;
      void connect();
    }
    return () => release();
  }, [connect, release]);

  useEffect(() => {
    if (state.phase === "failed") {
      // A failed session never keeps the microphone (reconnecting opens it again).
      transportRef.current?.close();
      transportRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
    }
  }, [state.phase]);

  const live = state.phase === "listening" || state.phase === "thinking" || state.phase === "speaking";

  const finish = useCallback(
    async (reason: "user" | "time_limit" | "disconnected" | "completed") => {
      if (ending) return;
      setEnding(true);
      setEndError(null);
      dispatch({ type: "local.ended" });
      const seconds = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      const recorder = recorderRef.current;
      const recorded = new Promise<Blob | null>((resolve) => {
        if (!recorder || recorder.state !== "recording") return resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder?.mimeType || "audio/webm" }) : null);
        recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        recorder.stop();
      });
      transportRef.current?.close();
      transportRef.current = null;
      const blob = await recorded;
      stopStream(streamRef.current);
      setMicOn(false);
      streamRef.current = null;
      if (saveAudio && blob && blob.size > 0) {
        const form = new FormData();
        form.append("audio", blob, "session.webm");
        await fetch(`/api/speaking/${attemptId}/audio`, { method: "POST", body: form }).catch(() => null);
      }
      const turns = finalTurns(stateRef.current);
      const r = await endSpeakingAction({ id: attemptId, reason, durationSeconds: Math.round(seconds), turns });
      if (!r.ok) {
        setEndError(r.error);
        setEnding(false);
        return;
      }
      router.push(`/speaking/attempts/${attemptId}${r.data.feedbackError ? `?feedback=${encodeURIComponent(r.data.feedbackError)}` : ""}`);
    },
    [attemptId, ending, router, saveAudio],
  );

  // Session clock and hard time limit (cost control).
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      const s = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
      setElapsed(s);
      if (s >= maxSeconds) void finish("time_limit");
    }, 500);
    return () => window.clearInterval(timer);
  }, [live, maxSeconds, finish]);

  const reconnect = () => {
    setReconnects((n) => n + 1);
    void connect();
  };

  const learnerSaid = state.turns.some((t) => t.role === "learner" && t.text.trim());
  const remaining = Math.max(0, maxSeconds - elapsed);

  return (
    <div className="flex flex-col gap-4">
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" aria-live="polite" data-testid="voice-phase" data-phase={state.phase} className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${PHASE_STYLE[state.phase]}`}>
          {state.phase === "connecting" || state.phase === "thinking" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {state.phase === "listening" ? <Mic className="size-4" aria-hidden="true" /> : null}
          {state.phase === "speaking" ? <Volume2 className="size-4" aria-hidden="true" /> : null}
          {state.phase === "failed" ? <WifiOff className="size-4" aria-hidden="true" /> : null}
          {PHASE_LABELS[state.phase]}
        </span>
        {live ? (
          <span className="text-sm tabular-nums text-muted">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · 还剩约 {Math.ceil(remaining / 60)} 分钟
          </span>
        ) : null}
        {micOn && live ? <span className="text-xs text-muted">麦克风已打开</span> : null}
      </div>

      {state.phase === "failed" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-coral/40 bg-coral-soft/40 p-4">
          <FormMessage tone="error">{state.error}</FormMessage>
          <div className="flex flex-wrap gap-2">
            {reconnects < MAX_RECONNECTS ? (
              <Button variant="outline" onClick={reconnect}>
                <RotateCcw aria-hidden="true" />
                重新连接
              </Button>
            ) : null}
            <Button
              variant="soft"
              disabled={ending}
              onClick={async () => {
                setEnding(true);
                release();
                // Close this attempt (keeping what was said) before the standard session starts.
                const seconds = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
                await closeSpeakingAction({ id: attemptId, reason: "disconnected", durationSeconds: Math.round(seconds), turns: finalTurns(stateRef.current) }).catch(() => null);
                onFallback();
              }}
            >
              <Unplug aria-hidden="true" />
              改用标准语音模式
            </Button>
            {learnerSaid ? (
              <Button variant="ghost" onClick={() => void finish("disconnected")} disabled={ending}>
                结束并查看反馈
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <TurnList turns={state.turns.map((t) => ({ id: t.id, role: t.role, text: t.text, pending: !t.final, interrupted: t.interrupted }))} emptyText={state.phase === "connecting" ? "正在连接，马上就好…" : "老师先开口，然后轮到你。"} />

      {transport === "simulated" && live ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-dashed border-border-strong p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!simText.trim()) return;
            transportRef.current?.simulate?.say(simText.trim());
            setSimText("");
          }}
        >
          <span className="text-xs text-muted">模拟会话（AI_PROVIDER=mock）：没有真正的语音识别，在这里输入「你说的话」来模拟。</span>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="模拟说一句"
              lang="en"
              value={simText}
              onChange={(e) => setSimText(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm"
              placeholder="I like reading books."
            />
            <Button size="sm" variant="outline" type="submit">
              <Send aria-hidden="true" />
              模拟说话
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => transportRef.current?.simulate?.drop()}>
              模拟断线
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {state.phase === "speaking" ? (
          <Button
            variant="outline"
            onClick={() => {
              transportRef.current?.interrupt();
              dispatch({ type: "local.interrupt" });
            }}
          >
            <Hand aria-hidden="true" />
            打断老师
          </Button>
        ) : null}
        {state.phase !== "failed" ? (
          <Button variant="danger" onClick={() => void finish("user")} disabled={ending || state.phase === "connecting"}>
            {ending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}
            {ending ? "正在结束，生成反馈…" : "结束练习"}
          </Button>
        ) : null}
      </div>
      {live ? <p className="text-xs text-muted">直接开口就可以，说话时老师会停下来听你说。安静的环境、戴耳机效果更好。</p> : null}
      {endError ? <FormMessage tone="error">{endError}</FormMessage> : null}
    </div>
  );
}
