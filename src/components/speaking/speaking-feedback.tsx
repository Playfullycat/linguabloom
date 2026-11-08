import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { SpeakingFeedback } from "@/modules/speaking/domain/feedback";

const COMPLETION: Record<string, { label: string; tone: BadgeTone }> = {
  met: { label: "完成了任务", tone: "mint" },
  partly: { label: "部分完成", tone: "yellow" },
  not_met: { label: "还没完成", tone: "coral" },
};
const CLARITY: Record<string, string> = { clear: "能听懂", mostly_clear: "大部分能听懂", hard_to_follow: "比较难听懂" };
const CONFIDENCE: Record<string, string> = { low: "低", medium: "中", high: "高" };

/**
 * Post-session feedback: can the listener understand you, then the one or
 * two most useful things to fix. Practice feedback only — never an exam score.
 */
export function SpeakingFeedbackView({ feedback }: { feedback: SpeakingFeedback }) {
  const done = COMPLETION[feedback.task_completion.rating] ?? COMPLETION.partly!;
  return (
    <div className="flex flex-col gap-5" data-testid="speaking-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={done.tone}>{done.label}</Badge>
        <Badge tone="blue">{CLARITY[feedback.comprehensibility.rating] ?? "大部分能听懂"}</Badge>
        <Badge tone="outline">可信度：{CONFIDENCE[feedback.confidence] ?? feedback.confidence}</Badge>
      </div>

      {feedback.priorities.length > 0 ? (
        <section className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">最值得先练的</h3>
          <ul className="list-disc pl-5 text-[0.9375rem] text-ink">
            {feedback.priorities.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <dl className="grid gap-3 text-[0.9375rem] sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-ink">任务完成</dt>
          <dd className="text-muted">{feedback.task_completion.comment_zh}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-ink">能不能听懂</dt>
          <dd className="text-muted">{feedback.comprehensibility.comment_zh}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-ink">流利度</dt>
          <dd className="text-muted">{feedback.fluency.comment_zh}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-ink">词汇</dt>
          <dd className="text-muted">{feedback.vocabulary.comment_zh}</dd>
        </div>
        {feedback.self_correction ? (
          <div>
            <dt className="text-sm font-semibold text-ink">自我纠正</dt>
            <dd className="text-muted">{feedback.self_correction}</dd>
          </div>
        ) : null}
        {feedback.strengths.length > 0 ? (
          <div>
            <dt className="text-sm font-semibold text-ink">做得好的地方</dt>
            <dd className="text-muted">{feedback.strengths.join("；")}</dd>
          </div>
        ) : null}
      </dl>

      {feedback.grammar.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">语法</h3>
          <ul className="flex flex-col gap-2">
            {feedback.grammar.map((g, i) => (
              <li key={i} className="rounded-xl border border-border p-3 text-[0.9375rem]">
                <p lang="en" className="text-coral-ink line-through decoration-coral/60">
                  {g.original}
                </p>
                <p lang="en" className="font-medium text-mint-ink">
                  {g.corrected}
                </p>
                <p className="mt-1 text-sm text-muted">{g.explanation_zh}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feedback.vocabulary.suggestions.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">换个说法</h3>
          <ul className="flex flex-col gap-1.5 text-[0.9375rem]">
            {feedback.vocabulary.suggestions.map((v, i) => (
              <li key={i}>
                <span lang="en">{v.original}</span> → <span lang="en" className="font-medium text-ink">{v.suggestion}</span>
                <span className="ml-1 text-sm text-muted">{v.explanation_zh}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feedback.can_do_evidence.length > 0 ? (
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">能力证据：</span>
          {feedback.can_do_evidence.join("；")}
        </p>
      ) : null}

      <p className="text-sm text-ink">
        <span className="font-semibold">下一步：</span>
        {feedback.next_action}
      </p>

      <div className="flex flex-col gap-1 rounded-xl bg-surface-soft p-3 text-xs text-muted">
        <p>发音：{feedback.pronunciation_note_zh}</p>
        {feedback.limitations.map((l, i) => (
          <p key={i}>· {l}</p>
        ))}
      </div>
    </div>
  );
}
