"use client";

import { ArrowRight, BookOpen, RotateCcw, Target } from "lucide-react";
import Link from "next/link";

import { SpeakButton } from "@/components/media/speak-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressRing } from "@/components/ui/progress-ring";
import type { LessonSummaryResult } from "@/modules/curriculum/services/progress";
import type { PlayerLesson } from "@/modules/curriculum/services/queries";

/** End-of-lesson summary (spec §5.3): what went well, what to review, what's next. */
export function LessonSummary({
  lesson,
  summary,
  onRestart,
}: {
  lesson: PlayerLesson;
  summary: LessonSummaryResult;
  onRestart: () => void;
}) {
  const words = summary.vocabularyKeys
    .map((key) => lesson.vocabulary.find((v) => v.key === key))
    .filter((v): v is PlayerLesson["vocabulary"][number] => Boolean(v));
  const mastery = summary.masteryEstimate;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        {mastery !== null ? (
          <ProgressRing value={mastery} size={96} strokeWidth={9} tone="mint" label={`首次答对 ${Math.round(mastery * 100)}%`} />
        ) : null}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted">本课完成</p>
          <h1 className="flex flex-wrap items-baseline justify-center gap-x-3">
            <span lang="en" className="text-2xl font-semibold text-ink">{lesson.titleEn}</span>
            <span className="text-lg text-muted">{lesson.titleZh}</span>
          </h1>
          {mastery !== null ? (
            <p className="text-sm text-muted">
              练习题首次答对 {summary.firstTryCorrect} / {summary.objectiveCount} 题
              {summary.openTasksDone > 0 ? `，完成 ${summary.openTasksDone} 个表达任务` : ""}。
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-primary-ink" aria-hidden="true" />
            这节课的目标
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {lesson.objectives.map((o) => (
              <li key={o.en} className="flex flex-col">
                <span className="text-ink">{o.zh}</span>
                <span lang="en" className="text-xs text-muted">{o.en}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {summary.toReview.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>值得再看一眼</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm text-ink">
              {summary.toReview.map((item) => (
                <li key={item.stepKey} className="flex flex-col gap-0.5 rounded-xl bg-yellow-soft px-3 py-2">
                  <span className="text-yellow-ink">{item.label}</span>
                  {item.answer ? (
                    <span className="text-ink">
                      正确答案：<span lang="en" className="font-medium">{item.answer}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {words.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary-ink" aria-hidden="true" />
              这节课的词汇
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-wrap gap-2">
              {words.map((w) => (
                <li key={w.key} className="flex items-center gap-1 rounded-xl bg-surface-soft py-1 pr-3 pl-1">
                  <SpeakButton text={w.text.split(" / ")[0]!} className="size-8" />
                  <span lang="en" className="text-sm font-medium text-ink">{w.text}</span>
                  <span className="text-xs text-muted">{w.zh}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">词汇复习功能（下一步 1.2）上线后，这些词会自动加入你的复习计划。</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw aria-hidden="true" />
          再学一遍
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link href={`/learn/units/${lesson.unitId}`}>返回单元</Link>
          </Button>
          {lesson.nextLessonId ? (
            <Button asChild>
              <Link href={`/lesson/${lesson.nextLessonId}`}>
                下一课
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
