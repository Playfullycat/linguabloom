import { BookOpen, CircleCheck, Headphones, Heart } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { MaterialSummary } from "@/modules/materials/services/materials";

import { COVERAGE_TONES, FIT_LABELS, FIT_TONES, coveragePercent } from "./fit";

/** Material cards grouped by level, with the learner-specific difficulty hint. */
export function MaterialList({ materials, learnerLabel, basis }: { materials: MaterialSummary[]; learnerLabel: string; basis: string }) {
  if (materials.length === 0) {
    return <EmptyState icon={BookOpen} title="还没有材料" description="内置材料会随内容更新加入；Phase 2 后半段可以导入你自己的文章和字幕。" />;
  }
  const levels = [...new Set(materials.map((m) => m.levelLabel))];
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        按你的水平（约 {learnerLabel}，依据：{basis}）标注难度。“生词”是文章生词表里你的词汇库还没有的词。
      </p>
      <p className="-mt-3 text-sm text-muted">
        “认识约 x%”是按你的水平和学过的词估计的已知词比例：98% 以上<strong className="font-medium text-ink">适合泛读</strong>（不查词也能顺畅读，适合多读），95%–98% <strong className="font-medium text-ink">适合精读</strong>（借助生词表和中文辅助），更低就是生词偏多。这是估计值，学的词越多越准。
      </p>
      {levels.map((level) => (
        <section key={level} aria-labelledby={`level-${level}`}>
          <h2 id={`level-${level}`} className="mb-3 text-base font-semibold text-ink">
            {level}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {materials
              .filter((m) => m.levelLabel === level)
              .map((m) => {
                const Icon = m.type === "reading" ? BookOpen : Headphones;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/${m.type}/${m.id}`}
                      className="flex h-full flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-soft text-blue-ink">
                          <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p lang="en" className="font-semibold text-ink">
                            {m.titleEn}
                          </p>
                          <p className="text-sm text-muted">{m.titleZh}</p>
                        </div>
                        {m.completed ? <CircleCheck className="size-5 shrink-0 text-mint-ink" aria-label="已完成" /> : null}
                        {m.favorite ? <Heart className="size-4 shrink-0 fill-current text-coral-ink" aria-label="已收藏" /> : null}
                      </div>
                      <p className="text-sm text-muted">{m.summaryZh}</p>
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        <Badge size="sm" tone={FIT_TONES[m.fit]}>
                          {FIT_LABELS[m.fit]}
                        </Badge>
                        <Badge size="sm" tone={COVERAGE_TONES[m.coverage.band]} title={m.coverage.label}>
                          {coveragePercent(m.coverage.ratio)} · {m.coverage.label}
                        </Badge>
                        <Badge size="sm">
                          {m.type === "reading" ? `${m.wordCount} 词` : `${m.sentenceCount} 句`}
                        </Badge>
                        <Badge size="sm">生词 {m.newWords}</Badge>
                        {m.topic ? <Badge size="sm" tone="outline">{m.topic}</Badge> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
