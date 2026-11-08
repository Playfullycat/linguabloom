import { Check, Info, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import type { PteWrittenFeedback } from "@/modules/pte/domain/feedback";
import type { ItemMark } from "@/modules/pte/domain/scoring";
import type { Reveal } from "@/modules/pte/services/pte";

export type ResultData = {
  score: number | null;
  maxScore: number | null;
  marks: ItemMark[];
  form: { words: number; status: "ok" | "outside_target" | "zero" } | null;
  feedback: PteWrittenFeedback | null;
  feedbackMessage: string | null;
  reveal: Reveal;
};

const FORM_TEXT = {
  ok: { tone: "mint", text: "词数符合要求（50–70）" },
  outside_target: { tone: "yellow", text: "词数不在 50–70 之间：官方会扣“形式”分" },
  zero: { tone: "coral", text: "词数少于 40 或多于 100：按官方规则这篇会得 0 分" },
} as const;

/**
 * The outcome of one attempt. Objective points come from the official rule
 * (shown with the result); AI comments are kept in their own box and never
 * shown as a score.
 */
export function ResultView({ result, scoringRule }: { result: ResultData; scoringRule: string }) {
  const { score, maxScore, marks, reveal } = result;
  return (
    <div className="flex flex-col gap-4" data-testid="pte-result">
      {score !== null && maxScore !== null ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-semibold text-ink" data-testid="pte-score">
            {score} / {maxScore}
          </span>
          <span className="text-sm text-muted">{scoringRule}</span>
        </div>
      ) : null}

      {marks.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="逐项判分">
          {marks.map((m, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", m.correct ? "bg-mint-soft text-mint-ink" : "bg-coral-soft text-coral-ink")}>
                {m.correct ? <Check className="size-3.5" aria-label="对" /> : <X className="size-3.5" aria-label="错" />}
              </span>
              <span lang="en" className="text-ink">
                {m.label}
              </span>
              {m.given !== null && !m.correct ? (
                <span className="text-sm text-muted">
                  你的：<span lang="en">{m.given}</span>
                </span>
              ) : null}
              {m.expected !== null && !m.correct ? (
                <span className="text-sm text-mint-ink">
                  正确：<span lang="en">{m.expected}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {result.form ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={FORM_TEXT[result.form.status].tone}>{result.form.words} 个词</Badge>
          <span className="text-sm text-ink">{FORM_TEXT[result.form.status].text}</span>
        </div>
      ) : null}

      {result.feedback ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border p-4" aria-labelledby="ai-feedback">
          <h3 id="ai-feedback" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            AI 辅助反馈
            <Badge tone="outline">把握：{{ low: "低", medium: "中", high: "高" }[result.feedback.confidence]}</Badge>
          </h3>
          <p className="text-xs text-muted">{result.feedback.not_official_zh}</p>
          {result.feedback.content.misrepresents ? <FormMessage tone="error">AI 认为这篇摘要和录音的意思不符；按官方规则，歪曲主题会得 0 分。</FormMessage> : null}
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="font-medium text-ink">内容</dt>
              <dd className="text-muted">
                {result.feedback.content.comment_zh}
                {result.feedback.content.covered.length ? ` 写到了：${result.feedback.content.covered.join("；")}。` : ""}
                {result.feedback.content.missing.length ? ` 漏掉了：${result.feedback.content.missing.join("；")}。` : ""}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-ink">语法</dt>
              <dd className="text-muted">{result.feedback.grammar.comment_zh}</dd>
              {result.feedback.grammar.issues.map((g, i) => (
                <dd key={i} lang="en" className="text-sm">
                  <span className="text-coral-ink line-through">{g.original}</span> → <span className="text-mint-ink">{g.corrected}</span>
                </dd>
              ))}
            </div>
            <div>
              <dt className="font-medium text-ink">词汇</dt>
              <dd className="text-muted">{result.feedback.vocabulary.comment_zh}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">拼写</dt>
              <dd className="text-muted">
                {result.feedback.spelling.errors.length === 0 ? "没有发现拼写错误。" : result.feedback.spelling.errors.map((e) => `${e.wrong} → ${e.right}`).join("，")}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-ink">{result.feedback.overall_zh}</p>
          {result.feedback.limitations.length ? <p className="text-xs text-muted">{result.feedback.limitations.join(" ")}</p> : null}
        </section>
      ) : null}
      {result.feedbackMessage ? <FormMessage tone="error">AI 反馈没有生成：{result.feedbackMessage} 词数检查和参考答案照常可以看。</FormMessage> : null}

      {reveal.explanationZh ? (
        <p className="flex items-start gap-2 rounded-2xl bg-blue-soft p-4 text-sm text-blue-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {reveal.explanationZh}
        </p>
      ) : null}
      {reveal.keyPointsZh.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium text-ink">录音要点</p>
          <ul className="list-disc pl-5 text-muted">
            {reveal.keyPointsZh.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reveal.modelAnswer ? (
        <div className="text-sm">
          <p className="font-medium text-ink">参考答案</p>
          <p lang="en" className="text-muted">
            {reveal.modelAnswer}
          </p>
        </div>
      ) : null}
      {reveal.transcript ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">录音文字稿</summary>
          <p lang="en" className="mt-1 text-ink" data-testid="pte-transcript">
            {reveal.transcript}
          </p>
        </details>
      ) : null}
    </div>
  );
}
