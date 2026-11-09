"use client";

import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, Play, RotateCcw, Square, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { submitFluencyAction } from "@/modules/fluency/actions";
import { COMPREHENSION_PASS, FLUENCY_KIND_LABELS, MIN_ROUND_MS, ROUNDS, wordsPerMinute, type FluencyKind } from "@/modules/fluency/domain/fluency";
import type { FluencyPracticeText, FluencyResult } from "@/modules/fluency/services/fluency";

type Rating = "smooth" | "ok" | "stuck";
type Round = { ms: number; rating?: Rating };
type Phase = "intro" | "prep" | "running" | "between" | "questions" | "result";

const RATINGS: { value: Rating; label: string }[] = [
  { value: "smooth", label: "讲得很顺" },
  { value: "ok", label: "还可以，停了几次" },
  { value: "stuck", label: "卡住好几次" },
];

const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));
/** Elapsed time rounds down, a countdown rounds up (it reads 0:00 only when time is up). */
const clock = (ms: number, countdown = false) => {
  const s = Math.max(0, countdown ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Passage({ text, large = true }: { text: FluencyPracticeText; large?: boolean }) {
  const dialogue = text.type === "listening";
  return (
    <div lang="en" className={cn("flex flex-col gap-2 leading-relaxed text-ink", large ? "text-lg" : "text-base")}>
      {dialogue ? (
        text.segments.map((s, i) => (
          <p key={i}>
            {s.speaker ? <span className="mr-2 font-semibold text-muted">{s.speaker}:</span> : null}
            {s.en}
          </p>
        ))
      ) : (
        <p>{text.segments.map((s) => s.en).join(" ")}</p>
      )}
    </div>
  );
}

export function FluencyPractice({ kind, text }: { kind: FluencyKind; text: FluencyPracticeText }) {
  const labels = FLUENCY_KIND_LABELS[kind];
  const total = ROUNDS[kind];
  const [phase, setPhase] = useState<Phase>("intro");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [now, setNow] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [peek, setPeek] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FluencyResult | null>(null);
  const [roundStart, setRoundStart] = useState(0);
  const firstStart = useRef(0);
  const requestId = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const index = rounds.length; // the round being done (0-based) while running
  const limit = kind === "timed_retell" ? text.retellLimitsMs[Math.min(index, 2)]! : null;
  const elapsed = phase === "running" ? Math.max(0, now - roundStart) : 0;
  const last = rounds.at(-1);

  const focusTop = () => requestAnimationFrame(() => topRef.current?.focus());

  const start = () => {
    const t = Date.now();
    if (firstStart.current === 0) firstStart.current = t;
    setRoundStart(t);
    setNow(t);
    setPeek(false);
    setError(null);
    setPhase("running");
    focusTop();
  };

  const submit = async (all: Round[]) => {
    setPending(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    const r = await submitFluencyAction({
      kind,
      contentId: text.id,
      clientRequestId: requestId.current,
      rounds: all,
      answers: kind === "speed_reading" ? Object.entries(answers).map(([questionId, choice]) => ({ questionId, choice })) : undefined,
      durationMs: Date.now() - firstStart.current,
    });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data);
    setPhase("result");
    focusTop();
  };

  const stop = (ms: number) => {
    if (ms < MIN_ROUND_MS) {
      setError("刚开始几秒，还不能结束。");
      return;
    }
    const next = [...rounds, { ms: Math.round(ms) }];
    setRounds(next);
    setError(null);
    if (kind === "speed_reading") setPhase("questions");
    else if (kind === "repeated_reading" && next.length === total) {
      setPhase("between");
      void submit(next);
    } else setPhase("between");
    focusTop();
  };

  // The clock ticks while a round runs; a timed retelling ends by itself when time is up.
  const onTick = useEffectEvent(() => {
    const t = Date.now();
    setNow(t);
    if (limit !== null && t - roundStart >= limit) stop(limit);
  });
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(onTick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const rate = (rating: Rating) => setRounds((rs) => rs.map((r, i) => (i === rs.length - 1 ? { ...r, rating } : r)));

  const restart = () => {
    setRounds([]);
    setAnswers({});
    setResult(null);
    setError(null);
    setPeek(false);
    firstStart.current = 0;
    requestId.current = null;
    setPhase("intro");
    focusTop();
  };

  const progress = phase === "result" ? 1 : (rounds.length + (phase === "running" ? 0.5 : 0)) / (total + (kind === "speed_reading" ? 1 : 0));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Button asChild variant="ghost" size="icon-sm" className="text-muted">
            <Link href="/fluency" title="退出（这次练习不会保存）">
              <X aria-hidden="true" />
              <span className="sr-only">退出练习，这次练习不会保存</span>
            </Link>
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="truncate text-sm">
              <span className="font-semibold text-ink">{labels.zh}</span>
              <span lang="en" className="ml-2 text-muted">
                {text.titleEn}
              </span>
              <span className="ml-2 hidden text-muted sm:inline">
                {text.levelLabel} · {text.wordCount} 词
              </span>
            </p>
            <ProgressBar value={progress} label={`练习进度`} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        <div ref={topRef} tabIndex={-1} className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card outline-none sm:p-7">
          {phase === "intro" ? (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-semibold text-ink">{labels.zh}</h1>
                <p className="text-muted">{labels.summary}</p>
              </div>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink">
                {labels.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {kind === "timed_retell" ? <li>三遍的时间：{text.retellLimitsMs.map((ms) => `${secs(ms)} 秒`).join(" → ")}</li> : null}
              </ol>
              {text.notYetEasy ? (
                <p className="rounded-xl bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">这篇你还没读完过，对你来说可能不算简单。流利度练习最好用已经读得懂的内容，可以先去读一遍。</p>
              ) : null}
              <p className="text-xs text-muted">{kind === "speed_reading" ? "默读即可。" : "请大声说出来。"}不录音，也不需要麦克风；只记录用时。</p>
              <div>
                <Button onClick={kind === "timed_retell" ? () => setPhase("prep") : start}>
                  <Play aria-hidden="true" />
                  {kind === "timed_retell" ? "先读原文" : kind === "speed_reading" ? "开始计时" : "开始第 1 遍"}
                </Button>
              </div>
            </>
          ) : null}

          {phase === "prep" ? (
            <>
              <h1 className="text-base font-semibold text-ink">先读一遍原文，不计时。准备好了再开始讲。</h1>
              <Passage text={text} />
              <div>
                <Button onClick={start}>
                  <Play aria-hidden="true" />
                  准备好了，开始第 1 遍（{secs(text.retellLimitsMs[0])} 秒）
                </Button>
              </div>
            </>
          ) : null}

          {phase === "running" ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-base font-semibold text-ink">
                  {kind === "speed_reading" ? "正在计时：读完点“读完了”" : kind === "repeated_reading" ? `第 ${index + 1} / ${total} 遍：大声读` : `第 ${index + 1} / ${total} 遍：不看原文讲出来`}
                </h1>
                <span className="text-2xl font-semibold tabular-nums text-ink" role="timer" aria-live="off" aria-label={limit !== null ? "剩余时间" : "已用时间"}>
                  {limit !== null ? clock(limit - elapsed, true) : clock(elapsed)}
                </span>
              </div>
              {limit !== null ? <ProgressBar value={Math.min(1, elapsed / limit)} label="已用时间" tone="primary" /> : null}
              {kind === "timed_retell" ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">提示词（按原文顺序）：</p>
                  <ul lang="en" className="flex flex-wrap gap-2">
                    {text.cues.map((c) => (
                      <li key={c} className="rounded-full bg-primary-soft px-3 py-1 text-base font-medium text-primary-ink">
                        {c}
                      </li>
                    ))}
                  </ul>
                  {index > 0 ? <p className="text-sm text-muted">时间更短了：试着讲出和上一遍一样多的内容。</p> : null}
                </div>
              ) : (
                <Passage text={text} />
              )}
              <div>
                <Button onClick={() => stop(Date.now() - roundStart)}>
                  <Square aria-hidden="true" />
                  {kind === "timed_retell" ? "讲完了" : "读完了"}
                </Button>
              </div>
            </>
          ) : null}

          {phase === "between" && last ? (
            <>
              <h1 className="text-base font-semibold text-ink">
                第 {rounds.length} 遍{kind === "timed_retell" ? (last.ms >= (text.retellLimitsMs[rounds.length - 1] ?? 0) ? "：时间到" : "讲完了") : "读完了"}
              </h1>
              <p className="text-ink">
                用时 <span className="font-semibold tabular-nums">{secs(last.ms)}</span> 秒
                {kind === "repeated_reading" ? (
                  <>
                    ，约 <span className="font-semibold tabular-nums">{wordsPerMinute(text.wordCount, last.ms)}</span> 词/分钟
                  </>
                ) : null}
                。
              </p>
              {kind === "timed_retell" ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-ink">这一遍感觉怎么样？</legend>
                  {RATINGS.map((r) => (
                    <label
                      key={r.value}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                        last.rating === r.value ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-soft",
                      )}
                    >
                      <input type="radio" name={`rating-${rounds.length}`} className="size-4 accent-[var(--color-primary)]" checked={last.rating === r.value} onChange={() => rate(r.value)} />
                      {r.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {kind === "timed_retell" && rounds.length < total ? (
                <div className="flex flex-col gap-2">
                  <Button variant="ghost" size="sm" className="w-fit" aria-expanded={peek} onClick={() => setPeek((v) => !v)}>
                    {peek ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {peek ? "收起原文" : "再看一眼原文（不计时）"}
                  </Button>
                  {peek ? <Passage text={text} large={false} /> : null}
                </div>
              ) : null}
              {rounds.length < total ? (
                <div>
                  <Button onClick={start} disabled={kind === "timed_retell" && !last.rating}>
                    <Play aria-hidden="true" />
                    开始第 {rounds.length + 1} 遍{kind === "timed_retell" ? `（${secs(text.retellLimitsMs[rounds.length]!)} 秒）` : ""}
                  </Button>
                </div>
              ) : kind === "timed_retell" ? (
                <div>
                  <Button onClick={() => void submit(rounds)} disabled={!last.rating || pending}>
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                    完成
                  </Button>
                </div>
              ) : pending ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  正在保存…
                </p>
              ) : error ? (
                <div>
                  <Button onClick={() => void submit(rounds)}>重新提交</Button>
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "questions" ? (
            <>
              <div className="flex flex-col gap-1">
                <h1 className="text-base font-semibold text-ink">读完了：用时 {secs(last?.ms ?? 0)} 秒。原文已收起。</h1>
                <p className="text-sm text-muted">凭印象回答，答对 {Math.round(COMPREHENSION_PASS * 100)}% 以上这次速度才算数。</p>
              </div>
              {text.questions.map((q, qi) => (
                <fieldset key={q.id} className="flex flex-col gap-2">
                  <legend className="mb-1 font-medium text-ink">
                    {qi + 1}. {q.promptZh}
                    {q.promptEn ? (
                      <span lang="en" className="block text-sm font-normal text-muted">
                        {q.promptEn}
                      </span>
                    ) : null}
                  </legend>
                  {q.options.map((o, oi) => (
                    <label
                      key={oi}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                        answers[q.id] === oi ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-soft",
                      )}
                    >
                      <input type="radio" name={q.id} className="size-4 accent-[var(--color-primary)]" checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                      <span lang="en">{o}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <div>
                <Button onClick={() => void submit(rounds)} disabled={pending || text.questions.some((q) => answers[q.id] === undefined)}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  提交答案
                </Button>
              </div>
            </>
          ) : null}

          {phase === "result" && result ? <ResultView result={result} text={text} onRestart={restart} /> : null}

          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        </div>
      </div>
    </div>
  );
}

function ResultView({ result, text, onRestart }: { result: FluencyResult; text: FluencyPracticeText; onRestart: () => void }) {
  const r = result;
  const ratingLabel = (v?: Rating) => RATINGS.find((x) => x.value === v)?.label ?? "";
  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <h1 className="text-xl font-semibold text-ink">完成了！已记入本周的流利度练习。</h1>

      {r.kind === "speed_reading" ? (
        <>
          <p className="text-ink">
            速度 <span className="text-3xl font-semibold tabular-nums">{r.rounds[0]?.wpm}</span> 词/分钟
            {r.questionCount ? (
              <>
                ，理解题答对 <span className="font-semibold tabular-nums">{r.correctCount}/{r.questionCount}</span>
              </>
            ) : null}
            。
          </p>
          <p className="text-sm text-muted">
            {r.counted
              ? r.previousWpm !== null
                ? `你最近几次的平均速度是 ${r.previousWpm} 词/分钟。${(r.rounds[0]?.wpm ?? 0) > r.previousWpm ? "这次更快了。" : "速度有起伏很正常，读得懂最重要。"}`
                : "这是你的第一条阅读速度记录。以后每次练习都可以和它比较。"
              : "理解题答对不到 70%，这次速度不计入记录。下次稍微放慢一点，确保读懂。"}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {r.review.map((q, i) => {
              const question = text.questions.find((x) => x.id === q.questionId);
              return (
                <li key={q.questionId} className={cn("rounded-xl px-3 py-2", q.isCorrect ? "bg-mint-soft text-mint-ink" : "bg-coral-soft text-coral-ink")}>
                  {i + 1}. {question?.promptZh} — {q.isCorrect ? "答对了" : <>正确答案：<span lang="en">{q.correctAnswer}</span></>}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">每一遍的用时</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">遍数</th>
                <th scope="col" className="py-1 text-right font-medium">用时</th>
                <th scope="col" className="py-1 text-right font-medium">{r.kind === "repeated_reading" ? "词/分钟" : "感觉"}</th>
              </tr>
            </thead>
            <tbody>
              {r.rounds.map((x, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 text-ink">第 {i + 1} 遍</td>
                  <td className="py-1.5 text-right tabular-nums text-ink">
                    {secs(x.ms)} 秒{x.limitMs ? <span className="text-muted"> / {secs(x.limitMs)}</span> : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-ink">{r.kind === "repeated_reading" ? x.wpm : ratingLabel(x.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted">
            {r.kind === "repeated_reading"
              ? r.gainPct !== null && r.gainPct > 0
                ? `第三遍比第一遍快了 ${r.gainPct}%。同样的内容读得越来越顺，就是流利度在长。`
                : "三遍速度差不多也没关系：读得稳、读得清楚同样重要。"
              : r.rounds.at(-1)?.rating === "smooth"
                ? "最后一遍时间最短，你还讲得很顺，说明这些表达已经能自动说出来了。"
                : "时间越来越短还要讲出同样的内容，本来就不容易。过几天再练一次这篇，会顺很多。"}
            {r.kind === "repeated_reading" && r.previousWpm !== null ? ` 上次这篇最后一遍是 ${r.previousWpm} 词/分钟。` : ""}
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/fluency">
            再练一篇
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" onClick={onRestart}>
          <RotateCcw aria-hidden="true" />
          这篇再练一次
        </Button>
        <Button asChild variant="ghost">
          <Link href="/today">回到今日计划</Link>
        </Button>
      </div>
    </div>
  );
}
