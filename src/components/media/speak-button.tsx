"use client";

import { Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSpeech } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";

type SpeakButtonProps = {
  text: string;
  /** Accessible label, e.g. "朗读：Good morning". Defaults to the text. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
  /** Show the label text next to the icon. */
  showText?: boolean;
};

/** Reads English text aloud with the browser's speech engine. */
export function SpeakButton({ text, label, size = "sm", className, showText = false }: SpeakButtonProps) {
  const { supported, speaking, play, stop } = useSpeech();
  const name = label ?? `朗读：${text}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size={showText ? (size === "sm" ? "sm" : "md") : size === "sm" ? "icon-sm" : "icon"}
      disabled={!supported}
      onClick={() => (speaking ? stop() : play(text))}
      aria-pressed={speaking}
      title={supported ? (speaking ? "停止朗读" : name) : "当前浏览器不支持朗读"}
      className={cn("text-primary-ink hover:bg-primary-soft", className)}
    >
      {speaking ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      {showText ? <span>{speaking ? "停止" : "朗读"}</span> : <span className="sr-only">{speaking ? "停止朗读" : name}</span>}
    </Button>
  );
}
