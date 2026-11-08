import { ChartLine, ExternalLink, GraduationCap, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { StartMockButton } from "@/components/pte/mock-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { SECTIONS, SECTION_LABELS } from "@/modules/pte/content";
import { listMocks } from "@/modules/pte/services/mock";
import { getCurrentVersion, listTaskTypes, taskStats } from "@/modules/pte/services/pte";

export const metadata: Metadata = { title: "PTE" };

const SKILL_LABELS: Record<string, string> = { listening: "听", reading: "读", speaking: "说", writing: "写" };

export default function PtePage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="PTE Academic"
        titleZh="PTE 专区"
        description="按官方题型分类练习，全部原创题目。客观题精确判分；口语和写作只给 AI 辅助反馈。都不是 Pearson 的正式成绩。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
        <PteHome />
      </Suspense>
    </>
  );
}

async function PteHome() {
  const user = await requireOwner();
  const db = getDb();
  const version = await getCurrentVersion(db);
  const [types, stats, mocks] = await Promise.all([listTaskTypes(db, version.id), taskStats(db, user.id), listMocks(db, user.id, 20)]);
  const open = new Set(mocks.filter((m) => m.status === "in_progress").map((m) => m.section));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>模拟练习与报告</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm" data-testid="pte-mock-start">
          <p className="text-muted">迷你模拟：一个部分里每个题型一道题，整体计时，可以保存后再继续。时间是各题时间相加，不是完整考试。</p>
          <div className="flex flex-wrap gap-3">
            {SECTIONS.map((s) => (
              <StartMockButton key={s} section={s} label={`${SECTION_LABELS[s]}模拟`} inProgress={open.has(s)} />
            ))}
            <Button asChild variant="soft" size="sm">
              <Link href="/pte/report">
                <ChartLine aria-hidden="true" />
                练习报告
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>考试版本与来源</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm" data-testid="pte-version">
          <p className="text-[0.9375rem] font-medium text-ink">{version.labelZh}</p>
          <p className="text-muted">
            官方题型页最近一次核对：{version.reviewedOn} · 生效日期：{version.effectiveFrom ?? "官方页面没有写"}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {version.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                  {s.title}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1 text-muted">
            {version.notesZh.map((n) => (
              <li key={n} className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {n}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {SECTIONS.map((section) => (
        <section key={section} aria-labelledby={`pte-${section}`} className="flex flex-col gap-2">
          <h2 id={`pte-${section}`} className="text-base font-semibold text-ink">
            {SECTION_LABELS[section]}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {types
              .filter((t) => t.section === section)
              .map((t) => {
                const s = stats.get(t.code);
                return (
                  <li key={t.code}>
                    <Link href={`/pte/${t.code}`} className="flex h-full flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ink">{t.nameZh}</span>
                        {t.practiceAvailable ? <Badge size="sm" tone="mint">可以练习</Badge> : <Badge size="sm">下一步上线</Badge>}
                      </span>
                      <span lang="en" className="text-sm text-muted">
                        {t.nameEn}
                      </span>
                      <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                        {t.skills.map((k) => (
                          <Badge key={k} size="sm" tone="outline">
                            {SKILL_LABELS[k] ?? k}
                          </Badge>
                        ))}
                        {s ? (
                          <span className="text-xs text-muted">
                            练过 {s.attempts} 次{s.avgShare !== null ? ` · 平均得分率 ${Math.round(s.avgShare * 100)}%` : ""}
                          </span>
                        ) : null}
                      </span>
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
