import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LevelBadge } from "@/components/learning/level-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { getLevel } from "@/modules/curriculum/services/queries";

export const metadata: Metadata = { title: "Level" };

export default function LevelPage({ params }: PageProps<"/learn/levels/[level]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载等级…" />}>
      <LevelContent params={params} />
    </Suspense>
  );
}

async function LevelContent({ params }: Pick<PageProps<"/learn/levels/[level]">, "params">) {
  const { level } = await params;
  if (!isCefrLevel(level)) notFound();
  const user = await requireOwner();
  const data = await getLevel(getDb(), user.id, level);
  if (!data) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/learn/path" className="hover:text-ink">
            ← 学习路径
          </Link>
        }
        title={data.label}
        titleZh={data.stageGoalZh}
        description={data.focusZh}
        actions={<LevelBadge level={data.code} />}
      />
      <ol className="grid gap-3 md:grid-cols-2">
        {data.units.map((unit) => {
          const published = unit.status === "published";
          const ratio = unit.lessonCount > 0 ? unit.completedLessonCount / unit.lessonCount : 0;
          return (
            <li key={unit.id}>
              <Link
                href={`/learn/units/${unit.id}`}
                className={
                  published
                    ? "group flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-raised"
                    : "group flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-border-strong p-5 text-muted transition-colors hover:bg-surface"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-semibold tracking-wide text-muted uppercase">Unit {unit.order}</span>
                  {published ? (
                    unit.completedLessonCount === unit.lessonCount && unit.lessonCount > 0 ? (
                      <Badge tone="mint" size="sm">已完成</Badge>
                    ) : (
                      <Badge tone="primary" size="sm">
                        <Clock aria-hidden="true" />
                        {unit.lessonCount} 课
                      </Badge>
                    )
                  ) : (
                    <Badge tone="neutral" size="sm">计划中</Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <h2 className="flex flex-wrap items-baseline gap-x-2">
                    <span lang="en" className={published ? "text-base font-semibold text-ink" : "text-base font-semibold"}>
                      {unit.titleEn}
                    </span>
                    <span className="text-sm">{unit.titleZh}</span>
                  </h2>
                  <p className="text-sm leading-relaxed text-muted">{unit.summaryZh}</p>
                </div>
                {published ? (
                  <div className="flex items-center gap-3">
                    <ProgressBar value={ratio} label={`Unit ${unit.order} 完成 ${Math.round(ratio * 100)}%`} tone="mint" />
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {unit.completedLessonCount} / {unit.lessonCount}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-primary-ink transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
