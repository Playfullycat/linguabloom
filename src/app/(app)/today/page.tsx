import { BookA, CalendarCheck, ChartLine, ClipboardCheck, Map, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { VocabularyStatusBadge } from "@/components/review/vocabulary-status-badge";
import { TodayPlanView } from "@/components/today/today-plan";
import { WeeklyNote } from "@/components/today/weekly-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { getRecentWords } from "@/modules/review/services/review";
import { STRAND_LABELS, type Strand } from "@/modules/study-plan/domain/session-templates";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";
import { SKIP_REASONS, SKIP_REASON_LABELS, getTodayPlan, hasTakenDiagnostic } from "@/modules/study-plan/services/plan";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在安排今天的学习…" />}>
      <TodayLoader />
    </Suspense>
  );
}

const STRAND_ORDER: Strand[] = ["language_focused_learning", "meaning_focused_input", "meaning_focused_output", "fluency_development"];

async function TodayLoader() {
  const user = await requireOwner();
  const db = getDb();
  const now = new Date();
  const { profile, preferences } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const [plan, week, recent, diagnosed] = await Promise.all([
    getTodayPlan(db, user.id, now),
    getWeeklyActivity(db, user.id, now, profile.timezone),
    getRecentWords(db, user.id, 5),
    hasTakenDiagnostic(db, user.id),
  ]);
  const lessonTask = plan.tasks.find((t) => t.kind === "lesson");
  const onboardingOpen = profile.onboardingCompletedAt === null;
  const maxDay = Math.max(1, ...week.days.map((d) => d.minutes));

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CalendarCheck className="size-4" aria-hidden="true" />
            <span lang="en">Today</span> · 今日
          </span>
        }
        title={plan.comeback ? "Welcome back. Let's pick up where you left off." : "Today"}
        titleZh={plan.comeback ? undefined : "今日"}
        description={
          plan.comeback
            ? "欢迎回来！今天的计划比平时轻一点，先把快要忘记的内容找回来。"
            : "按顺序做就好：先复习到期的内容，再学新课。每个任务都写了为什么推荐它。"
        }
      />

      {onboardingOpen ? (
        <Card className="mb-6 border-primary">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-ink">先花几分钟完成首次引导</p>
              <p className="mt-1 text-sm text-muted">设置讲解语言、学习目标和节奏，再做一个简短的水平诊断，起点会更合适。</p>
            </div>
            <Button asChild>
              <Link href="/onboarding">{profile.onboardingStep === "welcome" ? "开始引导" : "继续引导"}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>今天的计划</CardTitle>
            <CardDescription>可以换时长、只复习、调整顺序，或者跳过某项并说明原因。</CardDescription>
          </CardHeader>
          <CardContent>
            <TodayPlanView plan={plan} skipReasons={SKIP_REASONS.map((value) => ({ value, label: SKIP_REASON_LABELS[value] }))} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {preferences.showWeeklyStreak ? <WeeklyNote activeDays={week.activeDaysThisWeek} targetDays={preferences.weeklyDays} /> : null}

          <Card>
            <CardContent className="flex items-center justify-between gap-3 pt-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-yellow-soft text-yellow-ink">
                  <RotateCcw className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm text-muted">到期复习</p>
                  <p className="text-xl font-semibold text-ink">{plan.dueReviews} 张</p>
                </div>
              </div>
              <p className="text-right text-sm text-muted">今天已复习 {plan.reviewsToday} 次</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary-ink">
                <Map className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>当前课程</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {lessonTask ? (
                <p className="text-[0.9375rem] text-ink">{lessonTask.title.replace(/^(学习|继续)：/, "")}</p>
              ) : (
                <p className="text-sm text-muted">今天的计划里没有新课。</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="soft" size="sm">
                  <Link href="/learn/path">学习路径</Link>
                </Button>
                {!diagnosed ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/assessment">
                      <ClipboardCheck aria-hidden="true" />
                      做水平诊断
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-blue-soft text-blue-ink">
                <ChartLine className="size-5" aria-hidden="true" />
              </span>
              <div>
                <CardTitle>最近 7 天</CardTitle>
                <CardDescription>来自练习和复习记录，共 {Math.round(week.totalMinutes)} 分钟</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ol className="flex h-20 items-end gap-1.5" aria-label="每天学习分钟数">
                {week.days.map((d) => (
                  <li key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className="w-full rounded-t-md bg-primary/80"
                      style={{ height: `${Math.max(d.minutes > 0 ? 6 : 2, (d.minutes / maxDay) * 64)}px`, opacity: d.minutes > 0 ? 1 : 0.25 }}
                      aria-hidden="true"
                    />
                    <span className="text-[0.6875rem] text-muted">
                      {d.date.slice(5).replace("-", "/")}
                      <span className="sr-only">：{Math.round(d.minutes)} 分钟</span>
                    </span>
                  </li>
                ))}
              </ol>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {STRAND_ORDER.map((s) => (
                  <div key={s} className="flex justify-between gap-2 rounded-xl bg-surface-soft px-3 py-2">
                    <dt className="text-muted">{STRAND_LABELS[s]}</dt>
                    <dd className="font-medium text-ink">{Math.round(week.byStrand[s])} 分钟</dd>
                  </div>
                ))}
              </dl>
              {week.byStrand.fluency_development === 0 ? <p className="text-xs text-muted">流利度练习（限时复述、快速阅读）在后续阶段加入。</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-mint-soft text-mint-ink">
                <BookA className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>最近的词</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-sm text-muted">学完一节课，课里的词会出现在这里。</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recent.map((w) => (
                    <li key={w.entryId} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/vocabulary/${encodeURIComponent(w.entryId)}`} className="min-w-0 hover:underline">
                        <span lang="en" className="font-medium text-ink">
                          {w.text}
                        </span>
                        <span className="ml-2 text-sm text-muted">{w.zh}</span>
                      </Link>
                      <VocabularyStatusBadge status={w.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
