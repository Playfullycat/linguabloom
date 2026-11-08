"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isSpeechSupported, speak, stopSpeaking } from "@/lib/audio/speech";

import { openMicrophone, stopStream } from "./voice-transport";

/**
 * The teacher's voice: the provider's speech model when configured,
 * otherwise (or if it fails) the browser's own reading — labelled as such.
 */
export function useTeacherVoice(providerSpeech: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  const [source, setSource] = useState<"provider" | "browser" | "none">(providerSpeech ? "provider" : isSpeechSupported() ? "browser" : "none");
  const [playing, setPlaying] = useState(false);

  const cleanup = useCallback(() => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    resolveRef.current?.();
    resolveRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cleanup();
      stopSpeaking();
    },
    [cleanup],
  );

  const stop = useCallback(() => {
    cleanup();
    stopSpeaking();
    setPlaying(false);
  }, [cleanup]);

  const play = useCallback(
    async (text: string, slow = false) => {
      stop();
      const clean = text.replace(/（模拟）/g, "").trim();
      if (!clean) return;
      setPlaying(true);
      try {
        if (providerSpeech && source !== "browser") {
          try {
            const res = await fetch("/api/speaking/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean, slow }), signal: AbortSignal.timeout(20_000) });
            if (!res.ok) throw new Error("speech failed");
            const url = URL.createObjectURL(await res.blob());
            urlRef.current = url;
            const audio = audioRef.current ?? new Audio();
            audioRef.current = audio;
            audio.src = url;
            await new Promise<void>((resolve) => {
              resolveRef.current = resolve;
              audio.onended = () => resolve();
              audio.onerror = () => resolve();
              audio.play().catch(() => resolve());
            });
            return;
          } catch {
            // Provider speech failed: fall back to the browser for the rest of the session.
            setSource(isSpeechSupported() ? "browser" : "none");
          }
        }
        if (isSpeechSupported()) await speak(clean, slow ? 0.8 : 0.95);
      } finally {
        resolveRef.current = null;
        setPlaying(false);
      }
    },
    [providerSpeech, source, stop],
  );

  return { play, stop, playing, source };
}

export type RecorderPhase = "idle" | "requesting" | "recording";

/**
 * One recording per turn. The microphone is opened when recording starts and
 * released as soon as it stops (and on unmount), so it is never left on.
 */
export function useTurnRecorder(maxSeconds = 60) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const doneRef = useRef<((r: { blob: Blob; seconds: number } | null) => void) | null>(null);

  const release = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      release();
    },
    [release],
  );

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setElapsed(s);
      if (s >= maxSeconds && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, maxSeconds]);

  /** Resolves with the recording when it stops (button or time limit), or null on failure. */
  const record = useCallback(async (): Promise<{ blob: Blob; seconds: number } | null> => {
    setError(null);
    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await openMicrophone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "麦克风打不开。");
      setPhase("idle");
      return null;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    const started = Date.now();
    return new Promise((resolve) => {
      doneRef.current = resolve;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        release();
        setPhase("idle");
        setElapsed(0);
        resolve({ blob: new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), seconds: (Date.now() - started) / 1000 });
      };
      recorder.onerror = () => {
        release();
        setPhase("idle");
        resolve(null);
      };
      recorder.start();
      setPhase("recording");
    });
  }, [release]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  return { phase, elapsed, error, record, stop, maxSeconds };
}
