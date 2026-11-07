"use client";

import { BookmarkPlus, Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { collectWordAction } from "@/modules/materials/actions";
import type { LookupResult } from "@/modules/materials/services/materials";

export type WordCardState = { status: "loading"; word: string } | { status: "ready"; result: LookupResult } | { status: "error"; word: string; error: string };

/**
 * The looked-up word: meaning, pronunciation, example, and a choice between
 * "add to my vocabulary" and "just looking" (spec §2.5).
 */
export function WordCard({ contentId, state, onClose, onCollected }: { contentId: string; state: WordCardState; onClose: () => void; onCollected: (text: string) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const word = state.status === "ready" ? state.result.text : state.word;

  useEffect(() => {
    headingRef.current?.focus();
  }, [word]);

  return (
    <section
      aria-labelledby="word-card-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="rounded-2xl border border-primary/40 bg-surface p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="word-card-title" ref={headingRef} tabIndex={-1} lang="en" className="text-xl font-semibold text-ink outline-none">
            {word}
          </h2>
          <SpeakButton text={word} label={`朗读：${word}`} />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭词卡">
          <X aria-hidden="true" />
        </Button>
      </div>

      {state.status === "loading" ? <p className="mt-2 text-sm text-muted">正在查找…</p> : null}
      {state.status === "error" ? <p className="mt-2 text-sm text-coral-ink">{state.error}</p> : null}
      {state.status === "ready" ? (
        state.result.source === "none" ? (
          <div className="mt-2 flex flex-col gap-1 text-sm text-muted">
            <p>这个词不在本文生词表里，课程里也还没教过，暂时没有释义。</p>
            <p>它通常是这个级别应该认识的词；AI 释义会在 Phase 3 加入。</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              {state.result.ipa ? <span>{state.result.ipa}</span> : null}
              {state.result.pos ? <Badge size="sm">{state.result.pos}</Badge> : null}
              <Badge size="sm" tone="outline">
                {state.result.source === "glossary" ? "本文生词表" : "课程词汇"}
              </Badge>
            </p>
            <p className="text-[0.9375rem] font-medium text-ink">{state.result.zh}</p>
            {state.result.note ? <p className="text-sm text-muted">{state.result.note}</p> : null}
            {state.result.exampleEn ? (
              <div className="rounded-xl bg-surface-soft p-3 text-sm">
                <p lang="en" className="text-ink">
                  {state.result.exampleEn}
                </p>
                {state.result.exampleZh ? <p className="mt-0.5 text-muted">{state.result.exampleZh}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {state.result.collected ? (
                <span className="inline-flex items-center gap-1 text-sm text-mint-ink">
                  <Check className="size-4" aria-hidden="true" />
                  已在词汇库
                  <Link href="/vocabulary" className="ml-1 underline-offset-4 hover:underline">
                    查看
                  </Link>
                </span>
              ) : state.result.entryId ? (
                <>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await collectWordAction({ contentId, entryId: state.result.entryId! });
                        if (!r.ok) setMessage(r.error);
                        else {
                          setMessage(r.data.added ? "已加入词汇库，会出现在复习里。" : "词汇库里已经有这个词了。");
                          onCollected(state.result.text);
                        }
                      })
                    }
                  >
                    <BookmarkPlus aria-hidden="true" />
                    加入词汇库
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onClose}>
                    只查不收藏
                  </Button>
                </>
              ) : null}
            </div>
            {message ? (
              <p role="status" className="text-sm text-mint-ink">
                {message}
              </p>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
