"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Browser text-to-speech (Web Speech API) — the Phase 1 audio path.
 * Quality depends on the voices installed on the device; the UI labels it as
 * "browser reading". Phase 3 replaces it with generated audio files.
 */

export const SPEECH_RATES = [0.75, 0.9, 1] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

const RATE_KEY = "lb-speech-rate";
const RATE_EVENT = "lb-speech-rate-change";
const DEFAULT_RATE: SpeechRate = 0.9;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Prefer local English voices (en-GB, then en-US, then any en-*). */
export function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const rank = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase().startsWith("en-gb") ? 0 : v.lang.toLowerCase().startsWith("en-us") ? 1 : 2) + (v.localService ? 0 : 0.5);
  return [...english].sort((a, b) => rank(a) - rank(b))[0];
}

function readRate(): SpeechRate {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    return (SPEECH_RATES as readonly number[]).includes(value) ? (value as SpeechRate) : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

function subscribeRate(callback: () => void) {
  window.addEventListener(RATE_EVENT, callback);
  return () => window.removeEventListener(RATE_EVENT, callback);
}

/** Reading speed preference (UI preference, stored in the browser). */
export function useSpeechRate(): [SpeechRate, (rate: SpeechRate) => void] {
  const rate = useSyncExternalStore(subscribeRate, readRate, () => DEFAULT_RATE);
  const setRate = useCallback((next: SpeechRate) => {
    try {
      window.localStorage.setItem(RATE_KEY, String(next));
    } catch {
      // Storage unavailable: applies to this page only.
    }
    window.dispatchEvent(new Event(RATE_EVENT));
  }, []);
  return [rate, setRate];
}

/** Speak `text`; resolves when finished or interrupted. Cancels anything already playing. */
export function speak(text: string, rate: number): Promise<void> {
  if (!isSpeechSupported()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = rate;
    const voice = pickEnglishVoice(synth.getVoices());
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    // Resolves on normal end and when interrupted by another utterance.
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

const noopSubscribe = () => () => {};

/** Whether this browser can speak; false on the server (no hydration mismatch). */
export function useSpeechSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, isSpeechSupported, () => false);
}

/** Per-button speaking state + support detection (false during SSR). */
export function useSpeech() {
  const supported = useSpeechSupported();
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const [rate] = useSpeechRate();

  useEffect(() => {
    // Some browsers load voices asynchronously; ask early.
    if (isSpeechSupported()) window.speechSynthesis.getVoices();
  }, []);

  // Stop our own speech if the button disappears mid-sentence (unmount only).
  useEffect(
    () => () => {
      if (speakingRef.current) stopSpeaking();
    },
    [],
  );

  const play = useCallback(
    async (text: string) => {
      if (!isSpeechSupported()) return;
      setSpeaking(true);
      speakingRef.current = true;
      await speak(text, rate);
      speakingRef.current = false;
      setSpeaking(false);
    },
    [rate],
  );

  const stop = useCallback(() => {
    stopSpeaking();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  return { supported, speaking, play, stop };
}
