"use client";

import { CircleCheck, Heart, Star } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";

import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { lookupWordAction, recordEventAction, updateMaterialStateAction } from "@/modules/materials/actions";
import type { ReaderMaterial } from "@/modules/materials/services/materials";

import { ComprehensionQuestions } from "./comprehension-questions";
import { FIT_LABELS, FIT_TONES } from "./fit";
import { ASSIST_OPTIONS, TokenText, defaultAssist, type AssistMode } from "./token-text";
import { useStudyTime } from "./use-study-time";
import { WordCard, type WordCardState } from "./word-card";


/** Shared hooks for both readers: word lookup, collected words, saved sentences. */
export function useMaterialLookup(material: ReaderMaterial) {
  const glossary = useMemo(() => new Map(material.glossary.map((g) => [g.key, g])), [material.glossary]);
  const [collected, setCollected] = useState(() => new Set(material.glossary.filter((g) => g.collected).map((g) => g.text.toLowerCase())));
  const [card, setCard] = useState<WordCardState | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const lookup = (word: string, glossKey: string | null, segmentSeq: number | null) => {
    lastTrigger.current = document.activeElement as HTMLElement | null;
    setActiveKey(glossKey ?? word.toLowerCase());
    setCard({ status: "loading", word });
    void lookupWordAction({ contentId: material.id, word, glossKey, segmentSeq }).then((r) =>
      setCard(r.ok ? { status: "ready", result: { ...r.data, collected: r.data.collected || collected.has(r.data.text.toLowerCase()) } } : { status: "error", word, error: r.error }),
    );
  };
  const close = () => {
    setCard(null);
    setActiveKey(null);
    lastTrigger.current?.focus();
  };
  const onCollected = (text: string) => {
    setCollected((c) => new Set(c).add(text.toLowerCase()));
    setCard((c) => (c?.status === "ready" ? { status: "ready", result: { ...c.result, collected: true } } : c));
  };
  return { glossary, collected, card, activeKey, lookup, close, onCollected };
}

export function useMaterialState(material: ReaderMaterial) {
  const [favorite, setFavorite] = useState(material.state.favorite);
  const [saved, setSaved] = useState(material.state.savedSegments);
  const [completed, setCompleted] = useState(material.state.completed);
  const [note, setNote] = useState(material.state.note);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return {
    favorite,
    saved,
    completed,
    note,
    setNote,
    noteStatus,
    pending,
    toggleFavorite: () =>
      startTransition(async () => {
        const r = await updateMaterialStateAction({ op: "favorite", contentId: material.id, favorite: !favorite });
        if (r.ok) setFavorite(!favorite);
      }),
    toggleSaved: (seq: number) =>
      startTransition(async () => {
        const r = await updateMaterialStateAction({ op: "saveSegment", contentId: material.id, segmentSeq: seq });
        if (r.ok && r.data.savedSegments) setSaved(r.data.savedSegments);
      }),
    saveNote: () =>
      startTransition(async () => {
        const r = await updateMaterialStateAction({ op: "note", contentId: material.id, note });
        setNoteStatus(r.ok ? "笔记已保存。" : r.error);
      }),
    complete: () =>
      startTransition(async () => {
        const r = await updateMaterialStateAction({ op: "complete", contentId: material.id });
        if (r.ok) setCompleted(true);
      }),
  };
}

export function NotesCard({ state }: { state: ReturnType<typeof useMaterialState> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>笔记</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <label htmlFor="material-note" className="sr-only">
          阅读笔记
        </label>
        <textarea
          id="material-note"
          rows={3}
          maxLength={4000}
          value={state.note}
          onChange={(e) => state.setNote(e.target.value)}
          placeholder="记下想记住的表达、没看懂的地方……"
          className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-ring"
        />
        <div className="flex items-center gap-3">
          <Button size="sm" variant="soft" onClick={state.saveNote} disabled={state.pending}>
            保存笔记
          </Button>
          {state.noteStatus ? (
            <span role="status" className="text-sm text-muted">
              {state.noteStatus}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SourceNote({ material }: { material: ReaderMaterial }) {
  return (
    <p className="text-xs text-muted">
      {material.imported ? "你导入的材料，仅供个人学习使用。" : "LinguaBloom 原创分级材料（待 owner 复核）。"}
      {material.type === "listening" ? (material.media ? " 播放的是你上传的音频。" : " 朗读使用浏览器语音，音色取决于你的设备。") : null}
      {material.imported ? " 没有生词表：查词会在课程词汇和你导入的词表里找。" : null}
    </p>
  );
}

export function ReadingRoom({ material }: { material: ReaderMaterial }) {
  useStudyTime(material.id);
  const [assist, setAssist] = useState<AssistMode>(() => defaultAssist(material.levelLabel));
  const [highlight, setHighlight] = useState<number | null>(null);
  const words = useMaterialLookup(material);
  const state = useMaterialState(material);

  const showSentence = (seq: number) => {
    setHighlight(seq);
    document.getElementById(`segment-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById(`segment-${seq}`)?.focus();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-5 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="primary">{material.levelLabel}</Badge>
                <Badge tone={FIT_TONES[material.fit]}>
                  {FIT_LABELS[material.fit]}（你约 {material.learnerLevelLabel}）
                </Badge>
                {material.imported ? <Badge tone="outline">我的材料</Badge> : <Badge>生词 {material.newWords} 个</Badge>}
              </div>
              <SegmentedControl<AssistMode>
                ariaLabel="中文辅助"
                size="sm"
                value={assist}
                onValueChange={(v) => {
                  setAssist(v);
                  void recordEventAction({ contentId: material.id, kind: "assist_mode", detail: v });
                }}
                options={ASSIST_OPTIONS}
              />
            </div>

            <h2 lang="en" className="text-2xl font-semibold leading-snug text-ink">
              <TokenText tokens={material.titleTokens} glossary={words.glossary} showHints={assist === "keywords"} activeKey={words.activeKey} collected={words.collected} onWord={(w, k) => words.lookup(w, k, null)} />
            </h2>

            <div className="flex flex-col gap-1">
              {material.segments.map((s) => (
                <div
                  key={s.sequence}
                  id={`segment-${s.sequence}`}
                  tabIndex={-1}
                  className={cn("group flex items-start gap-2 rounded-xl px-2 py-2 outline-none transition-colors", highlight === s.sequence && "bg-yellow-soft")}
                >
                  <div className="min-w-0 flex-1">
                    <p lang="en" className={cn("text-[1.0625rem] leading-relaxed text-ink", assist === "keywords" && "leading-[2.4]")}>
                      <TokenText tokens={s.tokens} glossary={words.glossary} showHints={assist === "keywords"} activeKey={words.activeKey} collected={words.collected} onWord={(w, k) => words.lookup(w, k, s.sequence)} />
                    </p>
                    {assist === "translation" && s.zh ? <p className="mt-0.5 text-sm text-muted">{s.zh}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center opacity-70 group-hover:opacity-100">
                    <SpeakButton text={s.en} label={`朗读第 ${s.sequence + 1} 句`} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-pressed={state.saved.includes(s.sequence)}
                      aria-label={`收藏第 ${s.sequence + 1} 句`}
                      onClick={() => state.toggleSaved(s.sequence)}
                      className={state.saved.includes(s.sequence) ? "text-yellow-ink" : "text-muted"}
                    >
                      <Star className={state.saved.includes(s.sequence) ? "fill-current" : undefined} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <SourceNote material={material} />
          </CardContent>
        </Card>

        {material.questions.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>理解练习</CardTitle>
            </CardHeader>
            <CardContent>
              <ComprehensionQuestions contentId={material.id} questions={material.questions} onShowSentence={showSentence} />
            </CardContent>
          </Card>
        ) : null}

        <NotesCard state={state} />
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="查词与进度">
        {words.card ? (
          <div className="fixed inset-x-3 bottom-20 z-30 lg:static lg:inset-auto">
            <WordCard contentId={material.id} state={words.card} onClose={words.close} onCollected={words.onCollected} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong p-4 text-sm text-muted">
            点任意单词查看释义。带虚线的是本文生词，可以用 Tab 键逐个查看。
          </div>
        )}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <Button variant={state.favorite ? "soft" : "outline"} onClick={state.toggleFavorite} disabled={state.pending} aria-pressed={state.favorite}>
              <Heart className={state.favorite ? "fill-current" : undefined} aria-hidden="true" />
              {state.favorite ? "已收藏" : "收藏这篇"}
            </Button>
            {state.completed ? (
              <FormMessage tone="success">这篇已经读完了。可以随时回来重读。</FormMessage>
            ) : (
              <Button onClick={state.complete} disabled={state.pending}>
                <CircleCheck aria-hidden="true" />
                读完了
              </Button>
            )}
            {state.saved.length > 0 ? <p className="text-sm text-muted">收藏了 {state.saved.length} 个句子。</p> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
