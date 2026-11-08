"use client";

import { Loader2, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { speak, stopSpeaking } from "@/lib/audio/speech";

/** A short beep (the gap in "Select Missing Word"), made with Web Audio. */
async function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await new Promise((r) => setTimeout(r, 600));
    osc.stop();
    await ctx.close();
  } catch {
    // No Web Audio: the missing word is still obvious from the pause.
  }
}

/** Point an audio element at a file and play it (kept outside the component: it mutates the element). */
function playFile(audio: HTMLAudioElement, url: string, onEnded: () => void) {
  audio.src = url;
  audio.onended = onEnded;
  return audio.play();
}

type Source = "provider" | "browser" | "simulated";

/**
 * Plays a listening prompt: generated speech (cached file) when a speech model
 * is configured, otherwise the browser's voice — the label says which. In
 * timed mode it plays once, like the exam.
 */
export function AudioPrompt({ promptId, playOnce, withBeep, source, onPlayed }: { promptId: string; playOnce: boolean; withBeep: boolean; source: Source; onPlayed?: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "done">("idle");
  const [plays, setPlays] = useState(0);
  const [usedBrowser, setUsedBrowser] = useState(source === "browser");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      stopSpeaking();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const finish = async () => {
    if (withBeep) await beep();
    setState("done");
    setPlays((n) => n + 1);
    onPlayed?.();
  };

  const browserRead = async () => {
    setUsedBrowser(true);
    const res = await fetch(`/api/pte/script/${promptId}`);
    const body = (await res.json().catch(() => null)) as { text?: string } | null;
    setState("playing");
    if (body?.text) await speak(body.text, 1);
    await finish();
  };

  const play = async () => {
    setState("loading");
    if (usedBrowser) return browserRead();
    try {
      if (!urlRef.current) {
        const res = await fetch(`/api/pte/audio/${promptId}`);
        if (res.status === 409) return browserRead();
        if (!res.ok) throw new Error("audio failed");
        urlRef.current = URL.createObjectURL(await res.blob());
      }
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      setState("playing");
      await playFile(audio, urlRef.current, () => void finish());
    } catch {
      await browserRead();
    }
  };

  const disabled = state === "loading" || state === "playing" || (playOnce && plays >= 1);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-blue-soft p-4" data-testid="pte-audio">
      <Button onClick={() => void play()} disabled={disabled}>
        {state === "loading" ? <Loader2 className="animate-spin" aria-hidden="true" /> : state === "playing" ? <Volume2 aria-hidden="true" /> : <Play aria-hidden="true" />}
        {state === "playing" ? "正在播放…" : plays === 0 ? "播放录音" : playOnce ? "录音只能播放一次" : "再听一遍"}
      </Button>
      <span className="text-xs text-blue-ink" data-testid="pte-audio-source">
        {usedBrowser ? "浏览器朗读（没有配置语音合成模型，音质取决于设备）" : source === "simulated" ? "模拟语音（AI_PROVIDER=mock，没有声音）" : "AI 生成的录音（生成一次后缓存）"}
        {playOnce ? " · 计时模式下只能听一次" : ""}
      </span>
    </div>
  );
}
