import { cn } from "@/lib/utils";

export type TurnView = { id: string; role: "learner" | "ai"; text: string; pending?: boolean; interrupted?: boolean; note?: string };

/** The conversation so far: the teacher on the left, the learner on the right. */
export function TurnList({ turns, emptyText }: { turns: TurnView[]; emptyText: string }) {
  const visible = turns.filter((t) => t.text.trim() || t.pending);
  if (visible.length === 0) return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">{emptyText}</p>;
  return (
    <ol className="flex flex-col gap-2" aria-label="对话记录" data-testid="turn-list">
      {visible.map((t) => (
        <li key={t.id} className={cn("flex", t.role === "learner" ? "justify-end" : "justify-start")}>
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed",
              t.role === "learner" ? "bg-primary-soft text-primary-ink" : "border border-border bg-surface text-ink",
            )}
          >
            <span className="mb-0.5 block text-xs text-muted">{t.role === "learner" ? "你" : "老师"}</span>
            <span lang="en">{t.text || "…"}</span>
            {t.interrupted ? <span className="ml-1 text-xs text-muted">（被打断）</span> : null}
            {t.note ? <span className="mt-1 block text-xs text-muted">{t.note}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
