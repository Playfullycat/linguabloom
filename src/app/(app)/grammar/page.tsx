import { CircleCheck, Puzzle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { MASTERY_TONES } from "@/components/grammar/mastery";
import { Badge } from "@/components/ui/badge";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { MASTERY_LABELS, listGrammarPoints } from "@/modules/grammar/services/grammar";

export const metadata: Metadata = { title: "Grammar" };

const TOPIC_LABELS: Record<string, string> = {
  sentence: "句子结构",
  pronouns: "代词",
  verbs: "动词",
  nouns: "名词",
  questions: "疑问句",
  adverbs: "副词",
  prepositions: "介词",
  places: "地点",
  time: "时间",
  modals: "情态动词",
  tenses: "时态",
  adjectives: "形容词",
};

export default function GrammarPage({ searchParams }: PageProps<"/grammar">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Puzzle className="size-4" aria-hidden="true" />
            <span lang="en">Learn</span> · 学习
          </span>
        }
        title="Grammar"
        titleZh="语法"
        description="按教学顺序排列的语法地图。每个语法点都有规则、句子拆解、常见错误和练习；做错的题会进入错误本。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载语法地图…" />}>
        <GrammarMap searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink hover:bg-surface-soft",
      )}
    >
      {children}
    </Link>
  );
}

async function GrammarMap({ searchParams }: Pick<PageProps<"/grammar">, "searchParams">) {
  const params = await searchParams;
  const level = typeof params.level === "string" ? params.level : undefined;
  const topic = typeof params.topic === "string" ? params.topic : undefined;
  const user = await requireOwner();
  const all = await listGrammarPoints(getDb(), user.id);
  const points = all.filter((p) => (!level || p.level === level) && (!topic || p.topics.includes(topic)));
  const levels = [...new Map(all.map((p) => [p.level, p.levelLabel])).entries()];
  const topics = [...new Set(all.flatMap((p) => p.topics))];
  const href = (next: { level?: string; topic?: string }) => {
    const q = new URLSearchParams();
    if (next.level) q.set("level", next.level);
    if (next.topic) q.set("topic", next.topic);
    const s = q.toString();
    return s ? `/grammar?${s}` : "/grammar";
  };
  const mastered = all.filter((p) => p.mastery === "mastered").length;
  const published = all.filter((p) => p.status === "published").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          已开放 {published} 个语法点，你掌握得不错的有 {mastered} 个。“掌握得不错”= 最近至少 5 题、正确率 80% 以上，且没有未解决的同类错误。
        </p>
        <nav aria-label="按等级筛选" className="flex flex-wrap gap-2">
          <FilterLink href={href({ topic })} active={!level}>
            全部等级
          </FilterLink>
          {levels.map(([code, label]) => (
            <FilterLink key={code} href={href({ level: code, topic })} active={level === code}>
              {label}
            </FilterLink>
          ))}
        </nav>
        <nav aria-label="按主题筛选" className="flex flex-wrap gap-2">
          <FilterLink href={href({ level })} active={!topic}>
            全部主题
          </FilterLink>
          {topics.map((t) => (
            <FilterLink key={t} href={href({ level, topic: t })} active={topic === t}>
              {TOPIC_LABELS[t] ?? t}
            </FilterLink>
          ))}
        </nav>
      </div>

      {points.length === 0 ? <p className="text-sm text-muted">没有符合筛选条件的语法点。</p> : null}
      <ol className="grid gap-3 md:grid-cols-2">
        {points.map((p) => (
          <li key={p.id}>
            <Link
              href={`/grammar/${p.id}`}
              className={cn(
                "flex h-full flex-col gap-2 rounded-2xl border bg-surface p-4 shadow-card transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring",
                p.status === "planned" ? "border-dashed border-border-strong" : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-semibold text-primary-ink" aria-hidden="true">
                  {p.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{p.titleZh}</p>
                  <p lang="en" className="text-sm text-muted">
                    {p.titleEn}
                  </p>
                </div>
                {p.mastery === "mastered" ? <CircleCheck className="size-5 shrink-0 text-mint-ink" aria-hidden="true" /> : null}
              </div>
              <p className="text-sm text-muted">{p.summaryZh}</p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                <Badge size="sm" tone="primary">
                  {p.levelLabel}
                </Badge>
                <Badge size="sm" tone={MASTERY_TONES[p.mastery]}>
                  {MASTERY_LABELS[p.mastery]}
                </Badge>
                {p.status === "published" ? <Badge size="sm">{p.exerciseCount} 道练习</Badge> : null}
                {p.prerequisites.length > 0 ? (
                  <Badge size="sm" tone="outline">
                    先学：{p.prerequisites.map((x) => x.titleZh.split(/[：（ ]/)[0]).join("、")}
                  </Badge>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
