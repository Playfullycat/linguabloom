import { ArrowRight, Map } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LevelBadge } from "@/components/learning/level-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { listLevels } from "@/modules/curriculum/services/queries";

export const metadata: Metadata = { title: "Learning Path" };

export default function LearningPathPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Map className="size-4" aria-hidden="true" />
            <span lang="en">Learn</span> · 学习
          </span>
        }
        title="Learning Path"
        titleZh="学习路径"
        description="CEFR 七个等级的能力路线。等级描述的是“能用英语做什么”，而不是固定的单词数量；你可以按推荐顺序学，也可以直接打开任何已发布的单元。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载学习路径…" />}>
        <LevelList />
      </Suspense>
    </>
  );
}

async function LevelList() {
  const user = await requireOwner();
  const levels = await listLevels(getDb(), user.id);

  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:top-4 before:bottom-4 before:left-[27px] before:w-px before:bg-border-strong sm:before:left-[31px]">
      {levels.map((level) => {
        const available = level.publishedUnitCount > 0;
        const ratio = level.lessonCount > 0 ? level.completedLessonCount / level.lessonCount : 0;
        return (
          <li key={level.code} className="relative flex gap-4 sm:gap-5">
            <div className="z-10 grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-surface shadow-card sm:size-16">
              <LevelBadge level={level.code} />
            </div>
            <Link
              href={`/learn/levels/${level.code}`}
              className="group flex min-w-0 flex-1 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-raised"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-base font-semibold text-ink">{level.stageGoalZh}</h2>
                  <p className="text-sm text-muted">{level.focusZh}</p>
                </div>
                {available ? (
                  <Badge tone="primary" size="sm">
                    {level.publishedUnitCount} / {level.unitCount} 个单元可学
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    计划中 · {level.unitCount} 个单元
                  </Badge>
                )}
              </div>
              {available ? (
                <div className="flex items-center gap-3">
                  <ProgressBar value={ratio} label={`${level.label} 完成 ${Math.round(ratio * 100)}%`} className="max-w-xs" />
                  <span className="text-xs tabular-nums text-muted">
                    {level.completedLessonCount} / {level.lessonCount} 课
                  </span>
                </div>
              ) : null}
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink">
                查看单元
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
