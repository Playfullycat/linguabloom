"use client";

import { Mic, MicOff, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

type RecorderState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "recorded"; url: string; seconds: number }
  | { kind: "denied" };

const MAX_SECONDS = 60;

const noopSubscribe = () => () => {};
const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

/**
 * Local voice recording for speaking practice (spec §5.10, §14.2 audio).
 * - The microphone is requested only when the learner presses record.
 * - Permission denial and missing support are handled; typing is always the alternative.
 * - Tracks are stopped as soon as recording ends and on unmount (mic released).
 * - The recording stays in this page (blob URL) and is never uploaded.
 */
export function VoiceRecorder({ onRecorded }: { onRecorded?: (hasRecording: boolean) => void }) {
  const [state, setState] = useState<RecorderState>({ kind: "idle" });
  // Assume support during SSR; the real browser value replaces it on hydration.
  const supported = useSyncExternalStore(noopSubscribe, canRecord, () => true);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [releaseMic]);

  useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  const start = async () => {
    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ kind: "recorded", url, seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
        onRecorded?.(true);
      };
      recorder.start();
      setElapsed(0);
      setState({ kind: "recording", startedAt });
    } catch {
      releaseMic();
      setState({ kind: "denied" });
    }
  };

  const stop = () => recorderRef.current?.stop();

  const reset = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setState({ kind: "idle" });
    onRecorded?.(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-soft/60 p-4">
      {!supported ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MicOff className="size-4" aria-hidden="true" />
          当前浏览器不能录音。请在下面用文字作答。
        </p>
      ) : state.kind === "denied" ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-coral-ink">
            <MicOff className="size-4" aria-hidden="true" />
            没有拿到麦克风权限。可以在浏览器地址栏允许麦克风后重试，或者直接用文字作答。
          </p>
          <div>
            <Button variant="outline" size="sm" onClick={start}>
              <Mic aria-hidden="true" />
              重试录音
            </Button>
          </div>
        </div>
      ) : state.kind === "recorded" ? (
        <div className="flex flex-wrap items-center gap-3">
          <audio controls src={state.url} className="h-10 max-w-full" />
          <span className="text-xs tabular-nums text-muted">{state.seconds} 秒</span>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            重新录
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {state.kind === "recording" ? (
            <Button variant="danger" onClick={stop}>
              <Square aria-hidden="true" />
              停止录音
            </Button>
          ) : (
            <Button variant="soft" onClick={start} disabled={state.kind === "requesting"}>
              <Mic aria-hidden="true" />
              {state.kind === "requesting" ? "正在请求麦克风…" : "开始录音"}
            </Button>
          )}
          {state.kind === "recording" ? (
            <span role="status" className="flex items-center gap-2 text-sm tabular-nums text-coral-ink">
              <span className="size-2 animate-pulse rounded-full bg-coral" aria-hidden="true" />
              正在录音 {elapsed}s / {MAX_SECONDS}s
            </span>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted">录音只保存在这个页面里，不会上传，离开页面就会消失。</p>
    </div>
  );
}
