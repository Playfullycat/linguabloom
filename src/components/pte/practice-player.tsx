"use client";

import { ArrowDown, ArrowRight, ArrowUp, Keyboard, Loader2, Mic, RotateCcw, Send, Square, Timer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTurnRecorder } from "@/components/speaking/use-voice";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { submitPteAttemptAction, type SubmitData } from "@/modules/pte/actions";
import type { TextPart } from "@/modules/pte/content";
import type { Response } from "@/modules/pte/domain/scoring";
import type { MockState } from "@/modules/pte/services/mock";
import type { PracticeItem } from "@/modules/pte/services/pte";

import { AudioPrompt } from "./audio-prompt";
import { PteChart } from "./pte-chart";
import { ResultView, type ResultData } from "./result-view";

type Props = {
  item: PracticeItem;
  scoringRule: string;
  audioSource: "provider" | "browser" | "simulated";
  nextHref: string | null;
  /** Inside a mock test: no per-item result, the section clock belongs to the runner. */
  mock?: { id: string; getElapsed: () => number; onDone: (state: MockState | null) => void };
};

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
const countSentences = (s: string) => (s.trim() ? Math.max(1, s.trim().match(/[.!?](?=\s+[A-Z]|\s*$)/g)?.length ?? 0) : 0);

function initialResponse(item: PracticeItem): Response {
  if (item.speaking) return { kind: "spoken", transcript: "", seconds: 0, typed: true };
  const v = item.view;
  switch (v.task) {
    case "r_fib_dropdown":
      return { kind: "choices", choices: v.options.map(() => null) };
    case "r_fib_drag":
    case "l_fib_type":
      return { kind: "words", words: v.parts.filter((p) => p.type === "gap").map(() => null) };
    case "r_mcma":
    case "l_mcma":
    case "l_hiw":
      return { kind: "selected", selected: [] };
    case "r_reorder":
      return { kind: "order", order: v.items.map((i) => i.id) };
    case "l_sst":
    case "l_wfd":
    case "sw_summarize_written_text":
    case "sw_write_essay":
      return { kind: "text", text: "" };
    default:
      return { kind: "choice", choice: null };
  }
}

function toResult(d: SubmitData): ResultData {
  return { score: d.score, maxScore: d.maxScore, marks: d.marks, form: d.form, feedback: d.feedback, feedbackMessage: d.feedbackMessage, reveal: d.reveal, transcript: d.transcript };
}

/**
 * One PTE practice item. Practice mode: untimed, recordings can be replayed.
 * Timed mode: official time where the official page gives one (otherwise a
 * labelled suggestion), recordings play once, answers go in when time is up.
 * Spoken items: listen / read → prepare → record (stops by itself) → the
 * recording is transcribed; typing instead is possible but labelled.
 */
export function PracticePlayer({ item, scoringRule, audioSource, nextHref, mock }: Props) {
  const [mode, setMode] = useState<"practice" | "timed" | "mock" | null>(mock ? "mock" : null);
  const [response, setResponse] = useState<Response>(() => initialResponse(item));
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(() => (mock ? crypto.randomUUID() : null));
  const startedAt = useRef(0);
  const responseRef = useRef(response);
  useEffect(() => {
    responseRef.current = response;
  }, [response]);
  useEffect(() => {
    if (mock) startedAt.current = Date.now();
  }, [mock]);

  const done = useCallback(
    (d: SubmitData) => {
      if (mock) mock.onDone(d.mock);
      else setResult(toResult(d));
    },
    [mock],
  );

  const submit = useCallback(
    async (timedOut: boolean) => {
      if (busy || result || !mode || !requestId) return;
      setBusy(true);
      setError(null);
      const r = await submitPteAttemptAction({
        promptId: item.promptId,
        response: responseRef.current,
        mode,
        durationMs: Date.now() - startedAt.current,
        timedOut,
        clientRequestId: requestId,
        ...(mock ? { mockTestId: mock.id, elapsedSeconds: mock.getElapsed() } : {}),
      });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      done(r.data);
    },
    [busy, result, mode, requestId, item.promptId, mock, done],
  );

  /** A recording: transcribed and scored on the server (the audio isn't kept). */
  const submitRecording = useCallback(
    async (blob: Blob, seconds: number, timedOut: boolean) => {
      if (!mode || !requestId) return;
      setBusy(true);
      setError(null);
      const form = new FormData();
      form.append("audio", blob, "answer.webm");
      form.append(
        "payload",
        JSON.stringify({ promptId: item.promptId, mode, durationMs: Date.now() - startedAt.current, seconds, timedOut, clientRequestId: requestId, ...(mock ? { mockTestId: mock.id, elapsedSeconds: mock.getElapsed() } : {}) }),
      );
      try {
        const res = await fetch("/api/pte/attempt", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: SubmitData; silent?: boolean; error?: string } | null;
        if (body?.silent) return setError("没有识别到你说的话，请靠近麦克风再录一次。");
        if (!res.ok || !body?.data) return setError(body?.error ?? "提交失败，请再试一次。");
        done(body.data);
      } catch {
        setError("等了太久没有回应，请再试一次，或者改用文字代替。");
      } finally {
        setBusy(false);
      }
    },
    [mode, requestId, item.promptId, mock, done],
  );

  // Clock for non-spoken items; in timed mode the answer goes in when time is up.
  useEffect(() => {
    if (!mode || result || mock || item.speaking) return;
    const t = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(s);
      if (mode === "timed" && s >= item.timeLimitSeconds) void submit(true);
    }, 500);
    return () => window.clearInterval(t);
  }, [mode, result, mock, item.speaking, item.timeLimitSeconds, submit]);

  const start = (m: "practice" | "timed") => {
    startedAt.current = Date.now();
    setRequestId(crypto.randomUUID());
    setMode(m);
  };

  const again = () => {
    setResponse(initialResponse(item));
    setResult(null);
    setElapsed(0);
    setMode(null);
    setRequestId(null);
  };

  if (!mode) {
    return (
      <div className="flex flex-col gap-3" data-testid="pte-start">
        <p className="text-sm text-muted">
          {item.speaking
            ? `练习模式可以先准备再开始录音；计时模式按${item.speaking.officialResponse ? "官方" : "建议"}时间：准备 ${item.speaking.prepSeconds} 秒、录音 ${item.speaking.responseSeconds} 秒，到时间自动开始和停止。录音会发给 AI 服务转写，不会保存录音本身。`
            : `练习模式不计时，录音可以反复听。计时模式更接近考试：${item.officialTime ? `${Math.round(item.timeLimitSeconds / 60)} 分钟（官方时间）` : `建议 ${Math.round(item.timeLimitSeconds / 60) || 1} 分钟内完成（官方按整个部分计时，这类题没有单题时限）`}${item.hasAudio ? "，录音只能听一次" : ""}，到时间自动提交。`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start("practice")}>开始练习</Button>
          <Button variant="outline" onClick={() => start("timed")}>
            <Timer aria-hidden="true" />
            计时模式
          </Button>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, item.timeLimitSeconds - elapsed);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const strict = mode !== "practice";

  return (
    <div className="flex flex-col gap-5">
      {!mock && !item.speaking ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="timer" data-testid="pte-timer" className={cn("rounded-full px-3 py-1 font-medium tabular-nums", mode === "timed" && remaining <= 15 && !result ? "bg-coral-soft text-coral-ink" : "bg-surface-soft text-ink")}>
            {mode === "timed" ? `剩余 ${clock(remaining)}` : `用时 ${clock(elapsed)}`}
          </span>
          <span className="text-muted">{mode === "timed" ? "计时模式" : "练习模式"}</span>
        </div>
      ) : null}

      <Stimulus item={item} />

      {item.speaking ? (
        <SpokenAnswer
          item={item}
          strict={strict}
          audioSource={audioSource}
          disabled={Boolean(result) || busy}
          busy={busy}
          onRecorded={submitRecording}
          onTyped={(text) => {
            responseRef.current = { kind: "spoken", transcript: text, seconds: 0, typed: true };
            void submit(false);
          }}
        />
      ) : (
        <>
          {item.hasAudio ? <AudioPrompt promptId={item.promptId} playOnce={strict} withBeep={item.taskCode === "l_smw"} source={audioSource} /> : null}
          <fieldset disabled={Boolean(result) || busy} className="min-w-0">
            <Answer item={item} response={response} setResponse={setResponse} />
          </fieldset>
        </>
      )}

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      {!result && !item.speaking ? (
        <div>
          <Button onClick={() => void submit(false)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {busy ? "正在提交…" : mock ? "提交，下一题" : "提交答案"}
          </Button>
        </div>
      ) : null}
      {result ? (
        <>
          <ResultView result={result} scoringRule={scoringRule} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={again}>
              <RotateCcw aria-hidden="true" />
              再做一次
            </Button>
            {nextHref ? (
              <Button asChild>
                <Link href={nextHref}>
                  下一题
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** What the learner reads or looks at before answering (texts, chart, situation, essay topic). */
function Stimulus({ item }: { item: PracticeItem }) {
  const v = item.view;
  switch (v.task) {
    case "sw_read_aloud":
      return <Passage text={v.text} />;
    case "sw_describe_image":
      return <PteChart chart={v.chart} />;
    case "sw_respond_situation":
      return <Passage text={v.situation} />;
    case "sw_summarize_group_discussion":
      return <p className="text-sm text-muted">三位说话人：{v.speakers.join("、")}。总结时要说清楚谁提出了什么观点。</p>;
    case "sw_summarize_written_text":
      return <Passage text={v.passage} />;
    case "sw_write_essay":
      return <Passage text={v.topic} />;
    default:
      return null;
  }
}

/**
 * Spoken answer: optional prompt audio → preparation countdown → recording
 * with a countdown that stops by itself. In timed / mock mode each phase
 * starts automatically and the audio plays once.
 */
function SpokenAnswer({
  item,
  strict,
  audioSource,
  disabled,
  busy,
  onRecorded,
  onTyped,
}: {
  item: PracticeItem;
  strict: boolean;
  audioSource: "provider" | "browser" | "simulated";
  disabled: boolean;
  busy: boolean;
  onRecorded: (blob: Blob, seconds: number, timedOut: boolean) => void;
  onTyped: (text: string) => void;
}) {
  const s = item.speaking!;
  const recorder = useTurnRecorder(s.responseSeconds);
  const [phase, setPhase] = useState<"listen" | "prep" | "record" | "done">(item.hasAudio ? "listen" : "prep");
  const [left, setLeft] = useState(s.prepSeconds);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const { record } = recorder;

  const startRecording = useCallback(async () => {
    setPhase("record");
    const r = await record();
    setPhase("done");
    if (r && r.blob.size > 0) onRecorded(r.blob, r.seconds, r.seconds >= s.responseSeconds - 0.5);
  }, [record, onRecorded, s.responseSeconds]);

  // Preparation countdown.
  useEffect(() => {
    if (phase !== "prep" || s.prepSeconds === 0) return;
    const t = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [phase, s.prepSeconds]);

  // In timed / mock mode recording starts by itself when preparation is over.
  useEffect(() => {
    if (phase !== "prep" || !strict || left > 0) return;
    const t = window.setTimeout(() => void startRecording(), 0);
    return () => window.clearTimeout(t);
  }, [phase, strict, left, startRecording]);

  if (typing) {
    return (
      <div className="flex flex-col gap-2">
        <FormMessage tone="error">用文字代替口语：可以练内容，但这不是口语练习，结果也不算口语表现。</FormMessage>
        <textarea aria-label="用文字代替的回答" lang="en" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-[0.9375rem]" />
        <div>
          <Button onClick={() => onTyped(draft)} disabled={disabled || !draft.trim()}>
            <Send aria-hidden="true" />
            提交
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {item.hasAudio ? <AudioPrompt promptId={item.promptId} playOnce={strict} withBeep={false} source={audioSource} onPlayed={() => setPhase((p) => (p === "listen" ? "prep" : p))} /> : null}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4" data-testid="pte-speaking">
        <span role="timer" data-testid="pte-speaking-phase" data-phase={phase} className="rounded-full bg-surface-soft px-3 py-1 text-sm font-medium tabular-nums text-ink">
          {phase === "listen" ? "先听录音" : phase === "prep" ? (s.prepSeconds ? `准备 ${left} 秒` : "准备开口") : phase === "record" ? `正在录音 ${recorder.elapsed} / ${s.responseSeconds} 秒` : busy ? "正在转写和判分…" : "录音结束"}
        </span>
        {phase === "prep" && !strict ? (
          <Button onClick={() => void startRecording()} disabled={disabled}>
            <Mic aria-hidden="true" />
            开始录音
          </Button>
        ) : null}
        {phase === "record" ? (
          <Button variant="danger" onClick={recorder.stop}>
            <Square aria-hidden="true" />
            说完了
          </Button>
        ) : null}
        {phase === "done" && !busy && !disabled ? (
          <Button
            variant="outline"
            onClick={() => {
              setLeft(s.prepSeconds);
              setPhase("prep");
            }}
          >
            <RotateCcw aria-hidden="true" />
            重新录
          </Button>
        ) : null}
        {busy ? <Loader2 className="size-4 animate-spin text-muted" aria-hidden="true" /> : null}
      </div>
      {recorder.error ? <FormMessage tone="error">{recorder.error}</FormMessage> : null}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setTyping(true)} disabled={disabled || phase === "record"}>
          <Keyboard aria-hidden="true" />
          没有麦克风？用文字代替
        </Button>
      </div>
    </div>
  );
}

function Passage({ text }: { text: string }) {
  return (
    <p lang="en" className="rounded-2xl bg-surface-soft p-4 text-[0.9375rem] leading-relaxed text-ink">
      {text}
    </p>
  );
}

function Answer({ item, response, setResponse }: { item: PracticeItem; response: Response; setResponse: (r: Response) => void }) {
  const v = item.view;
  switch (v.task) {
    case "r_fib_dropdown": {
      const r = response as Extract<Response, { kind: "choices" }>;
      return (
        <p lang="en" className="text-[0.9375rem] leading-loose text-ink">
          {v.parts.map((p, i) =>
            p.type === "text" ? (
              <span key={i}>{p.text}</span>
            ) : (
              <select
                key={i}
                aria-label={`第 ${p.index + 1} 空`}
                value={r.choices[p.index] ?? ""}
                onChange={(e) => setResponse({ kind: "choices", choices: r.choices.map((c, j) => (j === p.index ? (e.target.value === "" ? null : Number(e.target.value)) : c)) })}
                className="mx-1 h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm"
              >
                <option value="">选择…</option>
                {v.options[p.index]!.map((o, k) => (
                  <option key={o} value={k}>
                    {o}
                  </option>
                ))}
              </select>
            ),
          )}
        </p>
      );
    }
    case "r_fib_drag":
      return <DragFill parts={v.parts} bank={v.bank} response={response as Extract<Response, { kind: "words" }>} setResponse={setResponse} />;
    case "l_fib_type": {
      const r = response as Extract<Response, { kind: "words" }>;
      return (
        <p lang="en" className="text-[0.9375rem] leading-loose text-ink">
          {v.parts.map((p, i) =>
            p.type === "text" ? (
              <span key={i}>{p.text}</span>
            ) : (
              <input
                key={i}
                aria-label={`第 ${p.index + 1} 空`}
                autoComplete="off"
                spellCheck={false}
                value={r.words[p.index] ?? ""}
                onChange={(e) => setResponse({ kind: "words", words: r.words.map((w, j) => (j === p.index ? e.target.value : w)) })}
                className="mx-1 h-9 w-32 rounded-lg border border-border-strong bg-surface px-2 text-sm"
              />
            ),
          )}
        </p>
      );
    }
    case "r_mcma":
    case "l_mcma": {
      const r = response as Extract<Response, { kind: "selected" }>;
      return (
        <div className="flex flex-col gap-3">
          {v.task === "r_mcma" ? <Passage text={v.passage} /> : null}
          <p lang="en" className="font-medium text-ink">
            {v.question}
          </p>
          <p className="text-xs text-muted">可以选多个；选错会扣分。</p>
          {v.options.map((o, i) => (
            <label key={o} className="flex min-h-11 items-start gap-2 text-[0.9375rem] text-ink">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--color-primary)]"
                checked={r.selected.includes(i)}
                onChange={(e) => setResponse({ kind: "selected", selected: e.target.checked ? [...r.selected, i] : r.selected.filter((x) => x !== i) })}
              />
              <span lang="en">{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case "r_mcsa":
    case "l_mcsa":
    case "l_hcs":
    case "l_smw": {
      const r = response as Extract<Response, { kind: "choice" }>;
      return (
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="选项">
          {v.task === "r_mcsa" ? <Passage text={v.passage} /> : null}
          {"question" in v ? (
            <p lang="en" className="font-medium text-ink">
              {v.question}
            </p>
          ) : (
            <p className="font-medium text-ink">{v.task === "l_hcs" ? "哪一段最能概括录音？" : "录音最后被“哔”声盖住的词是？"}</p>
          )}
          {v.options.map((o, i) => (
            <label key={o} className="flex min-h-11 items-start gap-2 text-[0.9375rem] text-ink">
              <input type="radio" name={`pte-${item.promptId}`} className="mt-1 size-4 accent-[var(--color-primary)]" checked={r.choice === i} onChange={() => setResponse({ kind: "choice", choice: i })} />
              <span lang="en">{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case "r_reorder":
      return <Reorder items={v.items} response={response as Extract<Response, { kind: "order" }>} setResponse={setResponse} />;
    case "l_hiw": {
      const r = response as Extract<Response, { kind: "selected" }>;
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">点出和录音不一样的词；再点一次取消。选错会扣分。</p>
          <p lang="en" className="text-[0.9375rem] leading-loose text-ink" data-testid="hiw-text">
            {v.tokens.map((t, i) =>
              t.word ? (
                <button
                  key={i}
                  type="button"
                  aria-pressed={r.selected.includes(i)}
                  onClick={() => setResponse({ kind: "selected", selected: r.selected.includes(i) ? r.selected.filter((x) => x !== i) : [...r.selected, i] })}
                  className={cn("rounded px-0.5 hover:bg-yellow-soft focus-visible:outline-2 focus-visible:outline-ring", r.selected.includes(i) && "bg-yellow text-ink")}
                >
                  {t.text}
                </button>
              ) : (
                <span key={i}>{t.text}</span>
              ),
            )}
          </p>
        </div>
      );
    }
    case "l_wfd": {
      const r = response as Extract<Response, { kind: "text" }>;
      return (
        <input
          aria-label="你听到的句子"
          lang="en"
          autoComplete="off"
          spellCheck={false}
          value={r.text}
          onChange={(e) => setResponse({ kind: "text", text: e.target.value })}
          className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3 text-[0.9375rem]"
          placeholder="把句子一字不差地打出来"
        />
      );
    }
    case "l_sst":
    case "sw_summarize_written_text":
    case "sw_write_essay": {
      const r = response as Extract<Response, { kind: "text" }>;
      const n = countWords(r.text);
      const spec =
        v.task === "l_sst"
          ? { label: "你的摘要", rows: 6, hint: `${n} 个词（要求 50–70）`, ok: n >= 50 && n <= 70, placeholder: "用 50–70 个词概括录音" }
          : v.task === "sw_summarize_written_text"
            ? { label: "你的一句话摘要", rows: 4, hint: `${n} 个词，${countSentences(r.text)} 句（要求：一句话，5–75 词）`, ok: n >= 5 && n <= 75 && countSentences(r.text) === 1, placeholder: "用一句话（5–75 词）概括这段文字" }
            : { label: "你的作文", rows: 14, hint: `${n} 个词（要求 200–300）`, ok: n >= 200 && n <= 300, placeholder: "写一篇 200–300 词的议论文" };
      return (
        <div className="flex flex-col gap-1.5">
          <textarea aria-label={spec.label} lang="en" rows={spec.rows} maxLength={4000} value={r.text} onChange={(e) => setResponse({ kind: "text", text: e.target.value })} className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-[0.9375rem]" placeholder={spec.placeholder} />
          <span className={cn("text-xs", spec.ok ? "text-mint-ink" : "text-muted")}>{spec.hint}</span>
        </div>
      );
    }
    default:
      return null;
  }
}

/** Fill gaps from a word bank: drag a word onto a gap, or click a word and then a gap. Click a filled gap to clear it. */
function DragFill({ parts, bank, response, setResponse }: { parts: TextPart[]; bank: string[]; response: Extract<Response, { kind: "words" }>; setResponse: (r: Response) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const used = useMemo(() => new Set(response.words.filter(Boolean) as string[]), [response.words]);
  const place = (gap: number, word: string | null) => setResponse({ kind: "words", words: response.words.map((w, i) => (i === gap ? word : w === word ? null : w)) });
  return (
    <div className="flex flex-col gap-3">
      <p lang="en" className="text-[0.9375rem] leading-loose text-ink">
        {parts.map((p, i) =>
          p.type === "text" ? (
            <span key={i}>{p.text}</span>
          ) : (
            <button
              key={i}
              type="button"
              aria-label={`第 ${p.index + 1} 空${response.words[p.index] ? `：${response.words[p.index]}` : "（空）"}`}
              onClick={() => {
                if (picked) {
                  place(p.index, picked);
                  setPicked(null);
                } else if (response.words[p.index]) place(p.index, null);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const w = e.dataTransfer.getData("text/plain");
                if (w) place(p.index, w);
              }}
              className={cn("mx-1 inline-flex h-8 min-w-24 items-center justify-center rounded-lg border border-dashed px-2 align-middle text-sm", response.words[p.index] ? "border-primary bg-primary-soft text-primary-ink" : "border-border-strong text-muted")}
            >
              {response.words[p.index] ?? "　"}
            </button>
          ),
        )}
      </p>
      <div className="flex flex-wrap gap-2" aria-label="词框">
        {bank.map((w) => (
          <button
            key={w}
            type="button"
            draggable={!used.has(w)}
            disabled={used.has(w)}
            aria-pressed={picked === w}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", w)}
            onClick={() => setPicked(picked === w ? null : w)}
            className={cn("rounded-lg border px-3 py-1.5 text-sm", used.has(w) ? "border-border text-muted line-through" : picked === w ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface text-ink hover:bg-surface-soft")}
          >
            {w}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">先点一个词，再点要填的空（也可以直接拖过去）；点已填的空可以清除。</p>
    </div>
  );
}

/** Put paragraphs in order with move up / move down buttons (or drag). */
function Reorder({ items, response, setResponse }: { items: { id: string; text: string }[]; response: Extract<Response, { kind: "order" }>; setResponse: (r: Response) => void }) {
  const byId = new Map(items.map((i) => [i.id, i.text]));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= response.order.length) return;
    const next = [...response.order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    setResponse({ kind: "order", order: next });
  };
  const dragFrom = useRef<number | null>(null);
  return (
    <ol className="flex flex-col gap-2" aria-label="排序">
      {response.order.map((id, i) => (
        <li
          key={id}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragFrom.current !== null) move(dragFrom.current, i);
            dragFrom.current = null;
          }}
          className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3"
        >
          <span className="mt-0.5 text-sm font-semibold text-muted">{i + 1}.</span>
          <span lang="en" className="flex-1 text-[0.9375rem] text-ink">
            {byId.get(id)}
          </span>
          <span className="flex flex-col gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`上移：${byId.get(id)?.slice(0, 20)}`} onClick={() => move(i, i - 1)} disabled={i === 0}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`下移：${byId.get(id)?.slice(0, 20)}`} onClick={() => move(i, i + 1)} disabled={i === response.order.length - 1}>
              <ArrowDown aria-hidden="true" />
            </Button>
          </span>
        </li>
      ))}
    </ol>
  );
}
