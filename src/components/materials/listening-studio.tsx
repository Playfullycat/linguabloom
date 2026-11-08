"use client";

import { ChevronLeft, ChevronRight, CircleCheck, Heart, Pause, Play, Repeat1, Star, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { speak, stopSpeaking, useSpeechSupported } from "@/lib/audio/speech";
import { cn } from "@/lib/utils";
import { checkDictationAction, recordEventAction } from "@/modules/materials/actions";
import type { DictationWord } from "@/modules/materials/domain/text";
import type { ReaderMaterial } from "@/modules/materials/services/materials";

import { EnrichButton } from "@/components/ai/generation-controls";

import { ComprehensionQuestions } from "./comprehension-questions";
import { FIT_LABELS, FIT_TONES } from "./fit";
import { CoachLink, NotesCard, SourceNote, useMaterialLookup, useMaterialState } from "./reading-room";
import { TokenText } from "./token-text";
import { useStudyTime } from "./use-study-time";
import { WordCard } from "./word-card";

export const LISTENING_RATES = [0.75, 0.85, 1, 1.1, 1.25, 1.5] as const;
type Subtitles = "hidden" | "en" | "zh" | "bilingual";
type Practice = "questions" | "dictation" | "keyword";

/**
 * Listening Studio (spec §2.5, §5.7): listen first, then read. Sentence-by-
 * sentence playback, loops and speed control. Built-in materials have no
 * recorded audio: with a speech model each sentence is generated once and
 * cached as a file; otherwise the browser reads it (the page says which).
 * There are no fake word-level timestamps.
 */
export function ListeningStudio({ material, aiAvailable, ttsAvailable = false }: { material: ReaderMaterial; aiAvailable: boolean; ttsAvailable?: boolean }) {
  useStudyTime(material.id);
  const supported = useSpeechSupported();
  const [rate, setRate] = useState<number>(1);
  const [subtitles, setSubtitles] = useState<Subtitles>("hidden");
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loopOne, setLoopOne] = useState(false);
  const [practice, setPractice] = useState<Practice>("questions");
  const run = useRef(0);
  // Read live inside the playback loop, so changes apply to the next sentence.
  const rateRef = useRef(1);
  const loopRef = useRef(false);
  const plays = useRef(new Map<number, number>());
  const revealed = useRef(false);
  const words = useMaterialLookup(material);
  const state = useMaterialState(material);
  const segments = material.segments;

  // Real audio (imported): with subtitle timestamps every sentence can be played and looped exactly.
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasAudio = material.media !== null;
  const timed = hasAudio && segments.every((s) => s.startMs !== null && s.endMs !== null);
  const stopAtRef = useRef<number | null>(null);
  const currentRef = useRef<number | null>(null);
  const [ab, setAb] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const abRef = useRef(ab);
  // Generated speech per sentence; falls back to the browser voice if it fails once.
  const ttsRef = useRef<HTMLAudioElement | null>(null);
  const [ttsFailed, setTtsFailed] = useState(false);
  const useTts = ttsAvailable && !ttsFailed && !hasAudio;
  const canPlay = timed || supported || useTts;

  /** Say one sentence and resolve when it has finished (or was stopped). */
  const saySentence = (i: number, rate: number): Promise<void> => {
    if (!useTts) return speak(segments[i]!.en, rate);
    return new Promise((resolve) => {
      const audio = ttsRef.current ?? new Audio();
      ttsRef.current = audio;
      audio.src = `/api/tts/segment/${segments[i]!.id}`;
      audio.playbackRate = rate;
      audio.onended = () => resolve();
      audio.onpause = () => resolve();
      audio.onerror = () => {
        setTtsFailed(true);
        void speak(segments[i]!.en, rate).then(resolve);
      };
      audio.play().catch(() => {
        setTtsFailed(true);
        void speak(segments[i]!.en, rate).then(resolve);
      });
    });
  };

  useEffect(
    () => () => {
      stopSpeaking();
      ttsRef.current?.pause();
    },
    [],
  );

  const notePlay = (seq: number) => {
    const n = (plays.current.get(seq) ?? 0) + 1;
    plays.current.set(seq, n);
    void recordEventAction({ contentId: material.id, kind: n > 1 ? "replay" : "play", segmentSeq: seq });
  };

  const setCurrentSeq = (seq: number | null) => {
    currentRef.current = seq;
    setCurrent(seq);
  };

  /** Audio clock → current sentence, sentence end, sentence loop and A-B loop. */
  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime * 1000;
    const { a, b } = abRef.current;
    if (a !== null && b !== null && b > a && t >= b) {
      audio.currentTime = a / 1000;
      return;
    }
    if (!timed) return;
    const idx = segments.findLastIndex((s) => s.startMs! <= t + 30);
    const seq = idx === -1 ? 0 : idx;
    const seg = segments[currentRef.current ?? seq]!;
    if (loopRef.current && currentRef.current !== null && t >= seg.endMs!) {
      audio.currentTime = seg.startMs! / 1000;
      return;
    }
    if (stopAtRef.current !== null && t >= stopAtRef.current) {
      audio.pause();
      stopAtRef.current = null;
      setPlaying(false);
      return;
    }
    if (seq !== currentRef.current) {
      setCurrentSeq(seq);
      notePlay(seq);
    }
  };

  /** Play from `start`; one sentence (looping if asked) or through to the end. */
  const play = async (start: number, onlyOne: boolean) => {
    if (timed && audioRef.current) {
      const audio = audioRef.current;
      const seg = segments[start]!;
      run.current += 1;
      stopSpeaking();
      audio.playbackRate = rateRef.current;
      audio.currentTime = seg.startMs! / 1000;
      stopAtRef.current = onlyOne ? seg.endMs! : null;
      setCurrentSeq(start);
      notePlay(start);
      setPlaying(true);
      await audio.play().catch(() => setPlaying(false));
      return;
    }
    const id = ++run.current;
    setPlaying(true);
    let i = start;
    while (i < segments.length && run.current === id) {
      setCurrent(i);
      notePlay(i);
      await saySentence(i, rateRef.current);
      if (run.current !== id) return;
      if (loopRef.current) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      if (onlyOne) break;
      i += 1;
      await new Promise((r) => setTimeout(r, 350));
    }
    if (run.current === id) setPlaying(false);
  };
  const stop = () => {
    run.current += 1;
    stopSpeaking();
    ttsRef.current?.pause();
    audioRef.current?.pause();
    stopAtRef.current = null;
    setPlaying(false);
  };

  const setPoint = (which: "a" | "b") => {
    const t = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    const next = { ...abRef.current, [which]: t };
    abRef.current = next;
    setAb(next);
  };
  const clearAb = () => {
    abRef.current = { a: null, b: null };
    setAb({ a: null, b: null });
  };
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;

  /** For dictation: one sentence from the recording, or read aloud. */
  const playOne = (seq: number) => {
    if (timed) void play(seq, true);
    else void saySentence(seq, rateRef.current);
  };

  const changeSubtitles = (v: Subtitles) => {
    setSubtitles(v);
    if (v !== "hidden" && !revealed.current) {
      revealed.current = true;
      void recordEventAction({ contentId: material.id, kind: "reveal_transcript", detail: v });
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-5 pt-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone="primary">{material.levelLabel}</Badge>
              <Badge tone={FIT_TONES[material.fit]}>
                {FIT_LABELS[material.fit]}（你约 {material.learnerLevelLabel}）
              </Badge>
              <Badge>{segments.length} 句</Badge>
              {!hasAudio ? <Badge tone="outline">{useTts ? "AI 朗读（生成后缓存）" : "浏览器朗读"}</Badge> : null}
            </div>

            {!canPlay ? (
              <FormMessage tone="error">当前浏览器不支持语音朗读，无法播放。可以换用 Chrome、Edge 或 Safari 打开。</FormMessage>
            ) : null}
            {hasAudio ? (
              // Hidden when sentences are timed (our controls drive it); native controls otherwise.
              <audio
                ref={audioRef}
                src={material.media!.url}
                preload="metadata"
                controls={!timed}
                className={timed ? "hidden" : "w-full"}
                onTimeUpdate={onTimeUpdate}
                onPause={() => {
                  if (timed) setPlaying(false);
                }}
                onEnded={() => setPlaying(false)}
              >
                <track kind="captions" />
              </audio>
            ) : null}

            <div className="flex flex-col gap-3 rounded-2xl bg-blue-soft p-4">
              <div className="flex flex-wrap items-center gap-2">
                {playing ? (
                  <Button onClick={stop}>
                    <Pause aria-hidden="true" />
                    暂停
                  </Button>
                ) : (
                  <Button onClick={() => void play(current ?? 0, false)} disabled={!canPlay}>
                    <Play aria-hidden="true" />
                    {current === null ? "播放全文" : "从这句继续"}
                  </Button>
                )}
                <Button variant="outline" size="icon" aria-label="上一句" disabled={!canPlay || (current ?? 0) <= 0} onClick={() => void play(Math.max(0, (current ?? 0) - 1), true)}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="下一句"
                  disabled={!canPlay || (current ?? -1) >= segments.length - 1}
                  onClick={() => void play(Math.min(segments.length - 1, (current ?? -1) + 1), true)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button variant={loopOne ? "soft" : "ghost"} aria-pressed={loopOne} onClick={() => {
                    loopRef.current = !loopOne;
                    setLoopOne(!loopOne);
                  }}>
                  <Repeat1 aria-hidden="true" />
                  单句循环
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span id="rate-label" className="text-sm text-blue-ink">
                  语速
                </span>
                <SegmentedControl<string>
                  ariaLabel="语速"
                  size="sm"
                  value={String(rate)}
                  onValueChange={(v) => {
                    rateRef.current = Number(v);
                    setRate(Number(v));
                    if (audioRef.current) audioRef.current.playbackRate = Number(v);
                  }}
                  options={LISTENING_RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
                />
              </div>
              {hasAudio ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="A-B 循环">
                  <span className="text-sm text-blue-ink">A-B 循环</span>
                  <Button size="sm" variant="outline" onClick={() => setPoint("a")}>
                    设为 A 点
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPoint("b")} disabled={ab.a === null}>
                    设为 B 点
                  </Button>
                  {ab.a !== null || ab.b !== null ? (
                    <>
                      <span className="text-sm text-blue-ink" aria-live="polite">
                        {ab.a !== null ? `A ${fmt(ab.a)}` : ""}
                        {ab.b !== null ? ` → B ${fmt(ab.b)}` : ""}
                        {ab.a !== null && ab.b !== null && ab.b <= ab.a ? "（B 要在 A 之后）" : ""}
                      </span>
                      <Button size="sm" variant="ghost" onClick={clearAb}>
                        清除
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
              <p className="text-sm text-blue-ink" aria-live="polite">
                {current === null ? "先不看文字，完整听一遍，抓住大意。" : `正在第 ${current + 1} / ${segments.length} 句`}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">原文</h2>
              <SegmentedControl<Subtitles>
                ariaLabel="字幕"
                size="sm"
                value={subtitles}
                onValueChange={changeSubtitles}
                options={[
                  { value: "hidden", label: "隐藏" },
                  { value: "en", label: "英文" },
                  { value: "zh", label: "中文辅助" },
                  { value: "bilingual", label: "双语" },
                ]}
              />
            </div>

            <ol className="flex flex-col gap-1" aria-label="逐句播放">
              {segments.map((s) => (
                <li
                  key={s.sequence}
                  className={cn("flex items-start gap-2 rounded-xl px-2 py-2 transition-colors", current === s.sequence ? "bg-primary-soft" : "hover:bg-surface-soft")}
                  aria-current={current === s.sequence ? "true" : undefined}
                >
                  <Button variant="ghost" size="icon-sm" aria-label={`播放第 ${s.sequence + 1} 句`} disabled={!canPlay} onClick={() => void play(s.sequence, true)} className="text-primary-ink">
                    <Volume2 aria-hidden="true" />
                  </Button>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-xs font-medium text-muted">
                      {s.speaker ? `${s.speaker} · ` : ""}第 {s.sequence + 1} 句
                    </p>
                    {subtitles === "hidden" ? (
                      <p className="text-sm text-muted" aria-hidden="true">
                        ••• ••• •••
                      </p>
                    ) : null}
                    {subtitles === "en" || subtitles === "bilingual" ? (
                      <p lang="en" className="text-[1.0625rem] leading-relaxed text-ink">
                        <TokenText tokens={s.tokens} glossary={words.glossary} showHints={false} activeKey={words.activeKey} collected={words.collected} onWord={(w, k) => words.lookup(w, k, s.sequence)} />
                      </p>
                    ) : null}
                    {(subtitles === "zh" || subtitles === "bilingual") && s.zh ? <p className="text-sm text-muted">{s.zh}</p> : null}
                  </div>
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
                </li>
              ))}
            </ol>
            <SourceNote material={material} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>练习</CardTitle>
            <SegmentedControl<Practice>
              ariaLabel="练习类型"
              size="sm"
              value={practice}
              onValueChange={setPractice}
              options={[
                { value: "questions", label: "理解题" },
                { value: "dictation", label: "逐句听写" },
                { value: "keyword", label: "关键词听辨" },
              ]}
            />
          </CardHeader>
          <CardContent>
            {practice === "questions" ? (
              material.questions.length > 0 ? (
                <ComprehensionQuestions contentId={material.id} questions={material.questions} />
              ) : (
                <p className="text-sm text-muted">你导入的材料没有理解题（AI 出题在 Phase 3）。可以用逐句听写练习。</p>
              )
            ) : null}
            {practice === "dictation" ? <DictationPractice material={material} mode="sentence" playOne={playOne} canPlay={canPlay} /> : null}
            {practice === "keyword" ? <DictationPractice material={material} mode="keyword" playOne={playOne} canPlay={canPlay} /> : null}
          </CardContent>
        </Card>

        <NotesCard state={state} />
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="查词与进度">
        {words.card ? (
          <div className="fixed inset-x-3 bottom-20 z-30 lg:static lg:inset-auto">
            <WordCard contentId={material.id} state={words.card} onClose={words.close} onCollected={words.onCollected} aiAvailable={aiAvailable} sentence={words.sentence} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong p-4 text-sm text-muted">打开英文字幕后，可以点任意单词查看释义。</div>
        )}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <Button variant={state.favorite ? "soft" : "outline"} onClick={state.toggleFavorite} disabled={state.pending} aria-pressed={state.favorite}>
              <Heart className={state.favorite ? "fill-current" : undefined} aria-hidden="true" />
              {state.favorite ? "已收藏" : "收藏这段"}
            </Button>
            {state.completed ? (
              <FormMessage tone="success">这段已经听完了。</FormMessage>
            ) : (
              <Button onClick={state.complete} disabled={state.pending}>
                <CircleCheck aria-hidden="true" />
                听完了
              </Button>
            )}
            {aiAvailable ? <CoachLink material={material} seq={current} /> : null}
            {aiAvailable && material.imported && material.glossary.length === 0 && material.questions.length === 0 ? <EnrichButton contentId={material.id} /> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function DiffView({ words, extra }: { words: DictationWord[]; extra: string[] }) {
  return (
    <p lang="en" className="flex flex-wrap gap-1.5 text-[0.9375rem]">
      {words.map((w, i) => (
        <span
          key={i}
          className={cn(
            "rounded px-1",
            w.status === "ok" ? "bg-mint-soft text-mint-ink" : w.status === "wrong" ? "bg-coral-soft text-coral-ink" : "bg-yellow-soft text-yellow-ink underline decoration-dotted",
          )}
        >
          {w.word}
          <span className="sr-only">{w.status === "ok" ? "（对）" : w.status === "wrong" ? "（写错）" : "（漏了）"}</span>
        </span>
      ))}
      {extra.length > 0 ? <span className="text-sm text-muted">多写了：{extra.join(" ")}</span> : null}
    </p>
  );
}

/** Sentence dictation, or fill in one key word you heard. */
function DictationPractice({ material, mode, playOne, canPlay }: { material: ReaderMaterial; mode: "sentence" | "keyword"; playOne: (seq: number) => void; canPlay: boolean }) {
  const items = mode === "keyword" ? material.segments.filter((s) => s.keyword) : material.segments;
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ isCorrect: boolean; words: DictationWord[]; extra: string[]; expected: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState({ done: 0, correct: 0 });
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(0);
  const item = items[index];

  useEffect(() => () => stopSpeaking(), []);

  if (!item) return <p className="text-sm text-muted">这段材料没有可以练习的句子。</p>;

  const go = (next: number) => {
    setIndex(next);
    setText("");
    setResult(null);
    startedAt.current = 0;
  };

  const check = () => {
    setError(null);
    startTransition(async () => {
      const r = await checkDictationAction({
        contentId: material.id,
        segmentSeq: item.sequence,
        mode,
        text,
        clientRequestId: crypto.randomUUID(),
        durationMs: startedAt.current ? Math.min(3_600_000, Date.now() - startedAt.current) : undefined,
      });
      if (!r.ok) setError(r.error);
      else {
        setResult(r.data);
        setScore((s) => ({ done: s.done + 1, correct: s.correct + (r.data.isCorrect ? 1 : 0) }));
      }
    });
  };

  const inputId = `${mode}-input`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {mode === "sentence" ? "听一句，把整句写下来。大小写和标点不计。可以反复听，也可以调慢语速。" : "听这句话，填出空格里的词。"}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          第 {index + 1} / {items.length} 题{item.speaker ? ` · ${item.speaker}` : ""}
        </span>
        <span className="text-sm text-muted" aria-live="polite">
          {score.done > 0 ? `本轮写对 ${score.correct} / ${score.done}` : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="soft"
          disabled={!canPlay}
          onClick={() => {
            startedAt.current ||= Date.now();
            void recordEventAction({ contentId: material.id, kind: "play", segmentSeq: item.sequence, detail: mode });
            playOne(item.sequence);
          }}
        >
          <Volume2 aria-hidden="true" />
          播放这句
        </Button>
        <Button variant="ghost" size="icon" aria-label="跳到上一题" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="跳到下一题" disabled={index >= items.length - 1} onClick={() => go(index + 1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {mode === "keyword" && item.keyword ? (
        <p lang="en" className="text-lg text-ink">
          {item.keyword.before}
          <span className="mx-1 inline-block min-w-16 border-b-2 border-primary text-center text-primary-ink">{result ? result.expected : "?"}</span>
          {item.keyword.after}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {mode === "sentence" ? "写下你听到的句子" : "填入你听到的词"}
        </label>
        <Input
          id={inputId}
          lang="en"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={text}
          disabled={result !== null || pending}
          onChange={(e) => {
            startedAt.current ||= Date.now();
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim() && !result) check();
          }}
          className={mode === "keyword" ? "max-w-xs" : undefined}
        />
      </div>
      {result ? (
        <div className="flex flex-col gap-2">
          <FormMessage tone={result.isCorrect ? "success" : "error"}>{result.isCorrect ? "完全正确！" : "对照一下：绿色是写对的，红色是写错的，黄色是漏掉的。"}</FormMessage>
          {mode === "sentence" ? <DiffView words={result.words} extra={result.extra} /> : null}
          <p lang="en" className="text-sm text-muted">
            原句：{item.en}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => go(index)}>
              再写一次
            </Button>
            {index < items.length - 1 ? (
              <Button size="sm" onClick={() => go(index + 1)}>
                下一题
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={check} disabled={!text.trim() || pending}>
            检查
          </Button>
        </div>
      )}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
