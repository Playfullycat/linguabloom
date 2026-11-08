import { CalendarClock, Clock, RotateCcw, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LessonStatusBadge } from "@/components/learning/lesson-status-badge";
import { LevelBadge } from "@/components/learning/level-badge";
import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getUnit } from "@/modules/curriculum/services/queries";

export const metadata: Metadata = { title: "Unit" };

export default function UnitPage({ params }: PageProps<"/learn/units/[unitId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载单元…" />}>
      <UnitContent params={params} />
    </Suspense>
  );
}

async function UnitContent({ params }: Pick<PageProps<"/learn/units/[unitId]">, "params">) {
  const { unitId } = await params;
  const user = await requireOwner();
  const unit = await getUnit(getDb(), user.id, unitId);
  if (!unit) notFound();

  const header = (
    <PageHeader
      eyebrow={
        <Link href={`/learn/levels/${unit.level}`} className="hover:text-ink">
          ← {unit.levelLabel} · Unit {unit.order}
        </Link>
      }
      title={unit.titleEn}
      titleZh={unit.titleZh}
      description={unit.summaryZh}
      actions={<LevelBadge level={unit.level} />}
    />
  );

  if (unit.status !== "published" || !unit.content) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarClock}
          title="这个单元还在计划中"
          description="课程目录里已经有它的位置和学习目标，内容制作完成、审核后才会开放学习。可以先学同一等级里已发布的单元。"
          action={
            <Button asChild variant="soft">
              <Link href={`/learn/levels/${unit.level}`}>返回 {unit.levelLabel} 单元列表</Link>
            </Button>
          }
        />
      </>
    );
  }

  const next = unit.lessons.find((l) => l.status !== "completed") ?? unit.lessons[0];
  const { can_do: canDo, grammar_points: grammar, vocabulary } = unit.content;

  return (
    <>
      {header}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader
              title="课程"
              actions={
                next ? (
                  <Button asChild>
                    <Link href={`/lesson/${next.id}`}>
                      {next.status === "in_progress" ? "继续学习" : next.status === "completed" ? "从头复习" : "开始学习"}
                    </Link>
                  </Button>
                ) : null
              }
            />
            <ol className="flex flex-col gap-2.5">
              {unit.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <Link
                    href={`/lesson/${lesson.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-raised"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-semibold text-primary-ink tabular-nums">
                      {lesson.kind === "review" ? <RotateCcw className="size-4" aria-label="复习课" /> : lesson.order}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span lang="en" className="font-semibold text-ink">{lesson.titleEn}</span>
                        <span className="text-sm text-muted">{lesson.titleZh}</span>
                      </span>
                      <span className="flex items-center gap-3 text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden="true" />约 {lesson.estimatedMinutes} 分钟
                        </span>
                        {lesson.masteryEstimate !== null ? <span>首次答对 {Math.round(lesson.masteryEstimate * 100)}%</span> : null}
                      </span>
                    </span>
                    <LessonStatusBadge status={lesson.status} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <SectionHeader title="学完能做到" />
            <Card>
              <CardContent className="flex flex-col gap-3">
                {canDo.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <Target className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden="true" />
                    <div className="flex flex-col">
                      <span className="text-sm text-ink">{item.zh}</span>
                      <span lang="en" className="text-xs text-muted">{item.en}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          {grammar.map((point) => (
            <section key={point.id}>
              <SectionHeader title={`语法与表达：${point.title_zh}`} />
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <p lang="en" className="rounded-xl bg-primary-soft px-4 py-3 font-medium whitespace-pre-line text-primary-ink">{point.pattern}</p>
                  <p className="text-sm leading-relaxed text-ink">{point.explanation_zh}</p>
                  <ul className="flex flex-col gap-2">
                    {point.examples.map((ex) => (
                      <li key={ex.en} className="flex items-center gap-2">
                        <SpeakButton text={ex.en} />
                        <span className="flex flex-col">
                          <span lang="en" className="text-sm font-medium text-ink">{ex.en}</span>
                          <span className="text-xs text-muted">{ex.zh}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {point.common_errors.length > 0 ? (
                    <div className="flex flex-col gap-2 border-t border-border pt-4">
                      <h3 className="text-sm font-semibold text-ink">容易说错的地方</h3>
                      {point.common_errors.map((err) => (
                        <div key={err.wrong} className="flex flex-col gap-0.5 text-sm">
                          <span>
                            <span className="text-coral-ink line-through decoration-coral/60">{err.wrong}</span>
                            <span className="mx-2 text-muted">→</span>
                            <span className="font-medium text-mint-ink">{err.right}</span>
                          </span>
                          <span className="text-xs text-muted">{err.why_zh}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>

        <section>
          <SectionHeader
            title="本单元词汇"
            actions={<Badge tone="neutral" size="sm">{vocabulary.length} 个</Badge>}
          />
          <Card>
            <ul className="divide-y divide-border">
              {vocabulary.map((item) => (
                <li key={item.key} className="flex items-start gap-2 px-4 py-3">
                  <SpeakButton text={item.text.split(" / ")[0]!} label={`朗读：${item.text}`} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span lang="en" className="font-semibold text-ink">{item.text}</span>
                      {item.ipa ? <span className="font-ipa text-xs text-muted">{item.ipa}</span> : null}
                    </span>
                    <span className="text-sm text-ink">{item.zh}</span>
                    <span lang="en" className="text-xs text-muted">{item.example_en}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-xs text-muted">朗读使用浏览器自带的语音，效果因设备而异。词汇复习卡将在下一步（1.2）加入。</p>
        </section>
      </div>
    </>
  );
}
