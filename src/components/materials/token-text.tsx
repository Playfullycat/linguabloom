"use client";

import { cn } from "@/lib/utils";
import type { GlossaryEntry, Token } from "@/modules/materials/domain/text";

export type AssistMode = "translation" | "keywords" | "english";

export const ASSIST_OPTIONS: { value: AssistMode; label: string }[] = [
  { value: "translation", label: "逐句翻译" },
  { value: "keywords", label: "关键词提示" },
  { value: "english", label: "全英文" },
];

/** Default Chinese support by level (spec §2.5): beginners get translations, intermediate key words, advanced none. */
export function defaultAssist(levelLabel: string): AssistMode {
  if (levelLabel === "Pre-A1" || levelLabel === "A1") return "translation";
  if (levelLabel === "A2") return "keywords";
  return "english";
}

/**
 * A sentence as tappable words. Glossary (above-level) words are marked with a
 * dotted underline and reachable by keyboard; other words can still be tapped.
 */
export function TokenText({
  tokens,
  glossary,
  showHints,
  activeKey,
  collected,
  onWord,
}: {
  tokens: Token[];
  glossary: Map<string, GlossaryEntry>;
  showHints: boolean;
  activeKey: string | null;
  collected: Set<string>;
  onWord: (word: string, glossKey: string | null) => void;
}) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "space") return <span key={i}>{t.text}</span>;
        const g = t.gloss ? glossary.get(t.gloss) : undefined;
        const active = activeKey === `${t.gloss ?? t.text.toLowerCase()}`;
        const button = (
          <button
            type="button"
            // A word inside running text: an inline target, exempt from the 24px minimum (WCAG 2.5.8).
            data-inline-target=""
            tabIndex={g ? 0 : -1}
            onClick={() => onWord(t.text, t.gloss)}
            aria-label={g ? `查看生词：${t.text}${collected.has(g.text.toLowerCase()) ? "（已在词汇库）" : ""}` : undefined}
            className={cn(
              "rounded-sm px-px transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-ring",
              g && "underline decoration-dotted decoration-primary/70 underline-offset-4",
              g && collected.has(g.text.toLowerCase()) && "decoration-mint",
              active && "bg-primary-soft text-primary-ink",
            )}
          >
            {t.text}
          </button>
        );
        if (g && showHints) {
          return (
            <ruby key={i} className="[ruby-position:under]">
              {button}
              <rt className="text-[0.6875rem] font-normal text-muted">{g.zh.split("；")[0]}</rt>
            </ruby>
          );
        }
        return <span key={i}>{button}</span>;
      })}
    </>
  );
}
