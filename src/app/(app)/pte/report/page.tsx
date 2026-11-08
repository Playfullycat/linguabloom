import { ArrowLeft, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { SECTIONS, SECTION_LABELS, type Section } from "@/modules/pte/content";
import { getPteReport } from "@/modules/pte/services/report";

export const metadata: Metadata = { title: "PTE report" };

export default function PteReportPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/pte" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            PTE 专区
          </Link>
        }
        title="Practice report"
        titleZh="练习报告"
        description="按题型和技能看你的练习记录。只有客观题计算得分率；口语和写作题只记录次数和 AI 反馈。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在统计…" />}>
        <ReportLoader />
      </Suspense>
    </>
  );
}

/** Ten most recent shares as tiny columns (the trend); the numbers are in the row next to it. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  return (
    <span className="flex h-6 items-end gap-0.5" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className={i === values.length - 1 ? "w-1.5 rounded-t-sm bg-primary" : "w-1.5 rounded-t-sm bg-primary/35"} style={{ height: `${Math.max(8, v * 100)}%` }} />
      ))}
    </span>
  );
}

async function ReportLoader() {
  const user = await requireOwner();
  const db = getDb();
  const [report, { profile }] = await Promise.all([getPteReport(db, user.id), getLearnerSettings(db, user.id)]);
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>按技能</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4" data-testid="report-skills">
          <ul className="grid gap-4 md:grid-cols-2">
            {report.bySkill.map((s) => (
              <li key={s.skill} className="flex flex-col gap-1.5 rounded-2xl bg-surface-soft p-4">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-ink">{s.labelZh}</span>
                  <span className="text-muted">
                    客观题得分率 {pct(s.avgShare)} · 练过 {s.practisedTypes} / {s.contributing.length} 类
                  </span>
                </div>
                <ProgressBar value={s.avgShare ?? 0} label={`${s.labelZh} 得分率`} />
                <p className="text-xs text-muted">
                  计入这项技能的题型：
                  {s.contributing.map((c) => `${c.nameZh}${c.alsoCounts.length ? `（也计入${c.alsoCounts.map((x) => ({ listening: "听力", reading: "阅读", speaking: "口语", writing: "写作" })[x] ?? x).join("、")}）` : ""}`).join("、")}
                </p>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            技能交叉影响：官方说明里很多题型同时影响两项技能（例如“听写句子”同时计入听力和写作），所以一道题会同时出现在两项技能下。这里的得分率只来自你的原创练习题，不是 PTE 分数，也不是成绩预测。
          </p>
        </CardContent>
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section}>
          <CardHeader>
            <CardTitle>{SECTION_LABELS[section as Section]}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm" data-testid={`report-${section}`}>
                <thead className="text-muted">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">题型</th>
                    <th className="py-1.5 pr-3 font-medium">次数</th>
                    <th className="py-1.5 pr-3 font-medium">平均</th>
                    <th className="py-1.5 pr-3 font-medium">最好</th>
                    <th className="py-1.5 pr-3 font-medium">平均用时</th>
                    <th className="py-1.5 font-medium">最近 10 次</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byTask
                    .filter((t) => t.section === section)
                    .map((t) => (
                      <tr key={t.code} className="border-t border-border">
                        <td className="py-1.5 pr-3">
                          <Link href={`/pte/${t.code}`} className="text-primary-ink hover:underline">
                            {t.nameZh}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{t.attempts}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{t.objective ? pct(t.avgShare) : <span className="text-xs text-muted">AI 反馈</span>}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{t.objective ? pct(t.best) : "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{t.avgSeconds !== null ? `${t.avgSeconds} 秒` : "—"}</td>
                        <td className="py-1.5">
                          <Spark values={t.recent} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>常见的丢分</CardTitle>
          </CardHeader>
          <CardContent>
            {report.errors.length === 0 ? (
              <p className="text-sm text-muted">还没有记录。客观题丢分会按题型记进错误本。</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {report.errors.map((e) => (
                  <li key={e.id}>
                    <Link href={`/errors/${e.id}`} className="text-primary-ink hover:underline">
                      {e.title}
                    </Link>
                    <span className="text-muted">（{e.count} 次）</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>模拟练习</CardTitle>
          </CardHeader>
          <CardContent>
            {report.mocks.length === 0 ? (
              <p className="text-sm text-muted">还没有做过模拟练习。</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm" data-testid="report-mocks">
                {report.mocks.map((m) => (
                  <li key={m.id}>
                    <Link href={`/pte/mock/${m.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-surface-soft">
                      <span className="text-ink">{SECTION_LABELS[m.section as Section]}</span>
                      <span className="flex items-center gap-1.5 text-muted">
                        <Badge size="sm" tone={m.status === "completed" ? "mint" : "yellow"}>
                          {m.status === "completed" ? (m.endReason === "time_up" ? "时间到" : "已完成") : "未完成"}
                        </Badge>
                        {m.startedAt.toLocaleDateString("zh-CN", { timeZone: profile.timezone, month: "numeric", day: "numeric" })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
