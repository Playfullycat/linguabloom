"use client";

import { ArrowDown, ArrowRight, ArrowUp, Loader2, RotateCcw, Send, Timer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { submitPteAttemptAction } from "@/modules/pte/actions";
import type { TextPart } from "@/modules/pte/content";
import type { Response } from "@/modules/pte/domain/scoring";
import type { PracticeItem } from "@/modules/pte/services/pte";

import { AudioPrompt } from "./audio-prompt";
import { ResultView, type ResultData } from "./result-view";

type Props = {
  item: PracticeItem;
  scoringRule: string;
  audioSource: "provider" | "browser" | "simulated";
  nextHref: string | null;
};

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

function initialResponse(item: PracticeItem): Response {
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
      return { kind: "text", text: "" };
    default:
      return { kind: "choice", choice: null };
  }
}

/**
 * One PTE practice item. Practice mode: untimed, the recording can be replayed.
 * Timed mode: a countdown (official time for Summarize Spoken Text, otherwise a
 * suggestion — the official reading/listening parts are timed per section), the
 * recording plays once, and the answer is submitted when time runs out.
 */
export function PracticePlayer({ item, scoringRule, audioSource, nextHref }: Props) {
  const [mode, setMode] = useState<"practice" | "timed" | null>(null);
  const [response, setResponse] = useState<Response>(() => initialResponse(item));
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const startedAt = useRef(0);
  const responseRef = useRef(response);
  useEffect(() => {
    responseRef.current = response;
  }, [response]);

  const submit = useCallback(
    async (timedOut: boolean) => {
      if (busy || result || !mode || !requestId) return;
      setBusy(true);
      setError(null);
      const r = await submitPteAttemptAction({ promptId: item.promptId, response: responseRef.current, mode, durationMs: Date.now() - startedAt.current, timedOut, clientRequestId: requestId });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setResult({ score: r.data.score, maxScore: r.data.maxScore, marks: r.data.marks, form: r.data.form, feedback: r.data.feedback, feedbackMessage: r.data.feedbackMessage, reveal: r.data.reveal });
    },
    [busy, result, mode, requestId, item.promptId],
  );

  // Clock; in timed mode the answer goes in when time is up.
  useEffect(() => {
    if (!mode || result) return;
    const t = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(s);
      if (mode === "timed" && s >= item.timeLimitSeconds) void submit(true);
    }, 500);
    return () => window.clearInterval(t);
  }, [mode, result, item.timeLimitSeconds, submit]);

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
          练习模式不计时，录音可以反复听。计时模式更接近考试：
          {item.officialTime ? `${Math.round(item.timeLimitSeconds / 60)} 分钟（官方时间）` : `建议 ${Math.round(item.timeLimitSeconds / 60) || 1} 分钟内完成（官方按整个部分计时，这类题没有单题时限）`}
          {item.hasAudio ? "，录音只能听一次" : ""}，到时间自动提交。
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span role="timer" data-testid="pte-timer" className={cn("rounded-full px-3 py-1 font-medium tabular-nums", mode === "timed" && remaining <= 15 && !result ? "bg-coral-soft text-coral-ink" : "bg-surface-soft text-ink")}>
          {mode === "timed" ? `剩余 ${clock(remaining)}` : `用时 ${clock(elapsed)}`}
        </span>
        <span className="text-muted">{mode === "timed" ? "计时模式" : "练习模式"}</span>
      </div>

      {item.hasAudio ? <AudioPrompt promptId={item.promptId} playOnce={mode === "timed"} withBeep={item.taskCode === "l_smw"} source={audioSource} /> : null}

      <fieldset disabled={Boolean(result) || busy} className="min-w-0">
        <Answer item={item} response={response} setResponse={setResponse} />
      </fieldset>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      {!result ? (
        <div>
          <Button onClick={() => void submit(false)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {busy ? (item.taskCode === "l_sst" ? "正在提交，生成 AI 反馈…" : "正在判分…") : "提交答案"}
          </Button>
        </div>
      ) : (
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
      )}
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
    case "l_sst": {
      const r = response as Extract<Response, { kind: "text" }>;
      const n = countWords(r.text);
      return (
        <div className="flex flex-col gap-1.5">
          <textarea
            aria-label="你的摘要"
            lang="en"
            rows={6}
            maxLength={2000}
            value={r.text}
            onChange={(e) => setResponse({ kind: "text", text: e.target.value })}
            className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-[0.9375rem]"
            placeholder="用 50–70 个词概括录音"
          />
          <span className={cn("text-xs", n >= 50 && n <= 70 ? "text-mint-ink" : "text-muted")}>{n} 个词（要求 50–70）</span>
        </div>
      );
    }
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
