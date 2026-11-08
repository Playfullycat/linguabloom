import { ArrowLeft, Download, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { WeeklyChart, WeeklyHeatTable } from "@/components/abilities/weekly-charts";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { describeCorrelation } from "@/modules/abilities/domain/trends";
import { MIN_MATURE_REVIEWS, TREND_WEEKS, getLearningTrends } from "@/modules/abilities/services/trends";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Trends" };

export default function TrendsPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/progress" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            进度
          </Link>
        }
        title="Trends"
        titleZh="长期趋势"
        description={`最近 ${TREND_WEEKS} 周，按周看学习时间、复习保留率、能力证据和错误类别的变化。全部来自真实的学习记录。`}
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/trends" download>
              <Download aria-hidden="true" />
              导出 CSV
            </a>
          </Button>
        }
      />
      <Suspense fallback={<LoadingSkeleton label="正在整理学习记录…" />}>
        <TrendsLoader />
      </Suspense>
    </>
  );
}

async function TrendsLoader() {
  const user = await requireOwner();
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const trends = await getLearningTrends(db, user.id, new Date(), profile.timezone);
  const weekStarts = trends.weeks.map((w) => w.start);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>学习时间与保留率</CardTitle>
          <CardDescription>
            两张图对齐同样的周，方便对照。保留率只统计已经进入长期复习的卡片（回答“困难”及以上算记住），一周少于 {MIN_MATURE_REVIEWS} 次这样的复习时不显示。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5" data-testid="trends-time-retention">
          <div className="grid gap-6 lg:grid-cols-2">
            <WeeklyChart
              title="每周学习时间（分钟）"
              kind="bar"
              points={trends.weeks.map((w) => ({ start: w.start, value: w.minutes, detail: `成熟卡片复习 ${w.matureReviews} 次` }))}
              unit="minutes"
              emptyText="最近几周还没有学习记录。"
            />
            <WeeklyChart
              title="每周保留率"
              kind="line"
              points={trends.weeks.map((w) => ({ start: w.start, value: w.retention, detail: `成熟卡片复习 ${w.matureReviews} 次` }))}
              unit="percent"
              emptyText={`还没有哪一周有 ${MIN_MATURE_REVIEWS} 次以上成熟卡片的复习。坚持复习几周后，这里会出现保留率。`}
            />
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-surface-soft px-3 py-2 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {describeCorrelation(trends.correlation)}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">用表格查看每周数据</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">周（起始日）</th>
                    <th className="py-1 pr-3 font-medium">学习时间</th>
                    <th className="py-1 pr-3 font-medium">成熟卡片复习</th>
                    <th className="py-1 font-medium">保留率</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.weeks.map((w) => (
                    <tr key={w.start} className="border-t border-border tabular-nums">
                      <td className="py-1 pr-3">{w.start}</td>
                      <td className="py-1 pr-3">{w.minutes} 分钟</td>
                      <td className="py-1 pr-3">{w.matureReviews}</td>
                      <td className="py-1">{w.retention === null ? "数据不足" : `${Math.round(w.retention * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>各技能新增的能力证据</CardTitle>
          <CardDescription>每周新增的“通过”证据条数，颜色越深越多。证据来自课程练习、语法练习、理解题、听写、口语和写作。</CardDescription>
        </CardHeader>
        <CardContent>
          {trends.evidence.length === 0 ? (
            <p className="text-sm text-muted">最近 {TREND_WEEKS} 周还没有新的能力证据。</p>
          ) : (
            <WeeklyHeatTable caption="各技能每周新增的通过证据" rowHeader="技能" weeks={weekStarts} rows={trends.evidence} testId="trends-evidence" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>错误类别的变化</CardTitle>
          <CardDescription>每周记进错误本的次数（按类别）。某一类逐周变浅，说明这类错误在减少。</CardDescription>
        </CardHeader>
        <CardContent>
          {trends.errors.length === 0 ? (
            <p className="text-sm text-muted">最近 {TREND_WEEKS} 周没有记录错误。</p>
          ) : (
            <WeeklyHeatTable caption="各错误类别每周出现的次数" rowHeader="错误类别" weeks={weekStarts} rows={trends.errors} testId="trends-errors" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
