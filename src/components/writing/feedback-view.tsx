import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import type { WritingFeedback } from "@/modules/writing/domain/feedback";

const RATING: Record<WritingFeedback["task_completion"]["rating"], { label: string; tone: BadgeTone }> = {
  met: { label: "完成了任务", tone: "mint" },
  partly: { label: "部分完成", tone: "yellow" },
  not_met: { label: "没有完成任务", tone: "coral" },
};
const SEVERITY: Record<"high" | "medium" | "low", { label: string; tone: BadgeTone }> = {
  high: { label: "优先改", tone: "coral" },
  medium: { label: "需要改", tone: "yellow" },
  low: { label: "小问题", tone: "neutral" },
};
const CONFIDENCE: Record<WritingFeedback["confidence"], string> = { low: "把握较低", medium: "把握中等", high: "把握较高" };

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4 first:border-0 first:pt-0" aria-label={title}>
      <h3 className="text-[0.9375rem] font-semibold text-ink">
        <span className="mr-2 text-muted">{n}.</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Layered feedback (spec §5.11): most important first. The model rewrite is
 * folded away so the learner fixes their own text before seeing a version.
 */
export function FeedbackView({ feedback, grammarTitles }: { feedback: WritingFeedback; grammarTitles: Record<string, string> }) {
  const f = feedback;
  return (
    <div className="flex flex-col gap-4">
      {f.priorities.length > 0 ? (
        <div className="rounded-xl bg-primary-soft p-3 text-sm text-primary-ink">
          <p className="font-medium">先改这几处</p>
          <ol className="mt-1 list-decimal pl-5">
            {f.priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <Section n={1} title="任务完成度">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={RATING[f.task_completion.rating].tone}>{RATING[f.task_completion.rating].label}</Badge>
          <span className="text-ink">{f.task_completion.comment_zh}</span>
        </p>
      </Section>
      <Section n={2} title="主要内容">
        <p className="text-sm text-ink">
          {f.content.clear ? "意思表达清楚。" : "有些地方意思不够清楚。"}
          {f.content.comment_zh}
        </p>
      </Section>
      <Section n={3} title={`语法（${f.grammar.length}）`}>
        {f.grammar.length === 0 ? (
          <p className="text-sm text-mint-ink">没有发现需要改的语法问题。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {f.grammar.map((g, i) => (
              <li key={i} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap gap-1.5">
                  <Badge size="sm" tone={SEVERITY[g.severity].tone}>
                    {SEVERITY[g.severity].label}
                  </Badge>
                  <Badge size="sm">{ERROR_CATEGORY_LABELS[g.category as keyof typeof ERROR_CATEGORY_LABELS] ?? g.category}</Badge>
                  {g.grammar_point && grammarTitles[g.grammar_point] ? (
                    <Link href={`/grammar/${g.grammar_point}`} className="text-xs text-primary-ink underline-offset-4 hover:underline">
                      {grammarTitles[g.grammar_point]}
                    </Link>
                  ) : null}
                </span>
                <span lang="en" className="text-coral-ink line-through decoration-coral/60">
                  <span className="sr-only">原句：</span>
                  {g.original}
                </span>
                <span lang="en" className="text-mint-ink">
                  <span className="sr-only">改为：</span>✓ {g.corrected}
                </span>
                <span className="text-muted">{g.explanation_zh}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section n={4} title="词汇和搭配">
        {f.vocabulary.length === 0 ? (
          <p className="text-sm text-muted">没有需要特别调整的用词。</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {f.vocabulary.map((v, i) => (
              <li key={i}>
                <span lang="en" className="text-ink">
                  {v.original} → <span className="font-medium text-mint-ink">{v.suggestion}</span>
                </span>
                <span className="block text-muted">{v.explanation_zh}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section n={5} title="组织与衔接">
        <p className="text-sm text-ink">{f.organization.comment_zh}</p>
        {f.organization.suggestions_zh.length > 0 ? (
          <ul className="text-sm text-muted">
            {f.organization.suggestions_zh.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section n={6} title="更自然的说法">
        {f.natural_expressions.length === 0 ? (
          <p className="text-sm text-muted">暂时没有建议。</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {f.natural_expressions.map((x, i) => (
              <li key={i}>
                <span lang="en" className="text-ink">
                  {x.original} → <span className="font-medium text-mint-ink">{x.better}</span>
                </span>
                <span className="block text-muted">{x.note_zh}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="rounded-xl bg-surface-soft p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Badge size="sm" tone={f.confidence === "low" ? "yellow" : "blue"}>
            {CONFIDENCE[f.confidence]}
          </Badge>
          {f.level_evidence ? (
            <span className="text-ink">
              大约 {f.level_evidence.level} 的写作水平。{f.level_evidence.comment_zh}
            </span>
          ) : null}
        </p>
        {f.evidence.length > 0 ? <p className="mt-1 text-muted">依据：{f.evidence.join("；")}</p> : null}
        {f.limitations.length > 0 ? <p className="mt-1 text-muted">限制：{f.limitations.join("；")}</p> : null}
        <p className="mt-1 text-ink">下一步：{f.next_action}</p>
        <p className="mt-1 text-xs text-muted">这是 AI 的辅助反馈，不是官方考试评分。把握较低的反馈不会进入错误本，也不会改变你的水平估计。</p>
      </div>

      {f.model_rewrite ? (
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">看看示范（建议先自己改一遍再看）</summary>
          <p lang="en" className="mt-2 whitespace-pre-wrap text-ink">
            {f.model_rewrite}
          </p>
        </details>
      ) : null}
    </div>
  );
}
