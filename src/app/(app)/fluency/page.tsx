import { ArrowRight, BookOpen, Gauge, Headphones } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { startOfLocalDay, startOfLocalWeek } from "@/lib/time";
import { getCurrentEstimates } from "@/modules/assessment/services/assessment";
import { FLUENCY_KINDS, FLUENCY_KIND_LABELS, roundGain, weeklyFluencyTarget, type FluencyKind } from "@/modules/fluency/domain/fluency";
import { fluencyMinutesSince, listFluencyAttempts, listFluencyTexts, pickFluencyTask, speedReadingHistory, type FluencyRecord } from "@/modules/fluency/services/fluency";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { placementLevel } from "@/modules/study-plan/services/plan";

export const metadata: Metadata = { title: "Fluency" };

export default function FluencyPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="Fluency"
        titleZh="流利度"
        description="流利度练习不学新东西：用你已经读得懂的短文，把会的英语练得更快、更顺。不纠错、不需要 AI，也不录音。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
        <FluencyHome />
      </Suspense>
    </>
  );
}

const dateFmt = (d: Date, timeZone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone, month: "numeric", day: "numeric" }).format(d);

function recordSummary(r: FluencyRecord) {
  if (r.kind === "speed_reading") {
    const wpm = r.rounds[0]?.wpm ?? 0;
    const check = r.questionCount ? `，理解题 ${r.correctCount}/${r.questionCount}` : "";
    return `${wpm} 词/分钟${check}${r.counted ? "" : "（理解不足 70%，未计入速度）"}`;
  }
  if (r.kind === "repeated_reading") {
    const gain = roundGain(r.rounds);
    return `${r.rounds.map((x) => x.wpm).join(" → ")} 词/分钟${gain !== null && gain > 0 ? `，快了 ${gain}%` : ""}`;
  }
  const labels = { smooth: "很顺", ok: "还可以", stuck: "卡住了" } as const;
  return r.rounds.map((x) => `${Math.round(x.ms / 1000)} 秒${x.rating ? ` ${labels[x.rating]}` : ""}`).join(" · ");
}

async function FluencyHome() {
  const user = await requireOwner();
  const db = getDb();
  const now = new Date();
  const { profile } = await getLearnerSettings(db, user.id);
  const tz = profile.timezone;
  const estimates = await getCurrentEstimates(db, user.id);
  const level = placementLevel(estimates);
  const [texts, records, speed, weekMinutes, next] = await Promise.all([
    listFluencyTexts(db, user.id),
    listFluencyAttempts(db, user.id, 10),
    speedReadingHistory(db, user.id),
    fluencyMinutesSince(db, user.id, startOfLocalWeek(now, tz)),
    pickFluencyTask(db, user.id, { now, weekStart: startOfLocalWeek(now, tz), dayStart: startOfLocalDay(now, tz), level, always: true }),
  ]);
  const target = weeklyFluencyTarget(level);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        {next ? (
          <Card>
            <CardHeader>
              <CardTitle>现在可以练</CardTitle>
              <CardDescription>
                {FLUENCY_KIND_LABELS[next.kind].zh}：
                <span lang="en" className="font-medium text-ink">
                  {next.titleEn}
                </span>
                （{next.titleZh}，{next.levelLabel}）。{next.why === "completed" ? "你已经读完过这篇。" : "这篇比你现在的水平简单。"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/fluency/${next.kind}/${next.contentId}`}>
                  开始{FLUENCY_KIND_LABELS[next.kind].zh}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="fl-kinds" className="flex flex-col gap-3">
          <h2 id="fl-kinds" className="text-base font-semibold text-ink">
            三种练法
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
            {FLUENCY_KINDS.map((k) => (
              <li key={k} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card">
                <span className="font-semibold text-ink">{FLUENCY_KIND_LABELS[k].zh}</span>
                <span lang="en" className="text-xs text-muted">
                  {FLUENCY_KIND_LABELS[k].en}
                </span>
                <span className="text-sm text-muted">{FLUENCY_KIND_LABELS[k].summary}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fl-texts" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="fl-texts" className="text-base font-semibold text-ink">
              适合练流利度的短文
            </h2>
            <p className="text-sm text-muted">只列出你读完过的，或者比你现在的水平低一级以上的阅读和听力材料。没练过的排在前面。</p>
          </div>
          {texts.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="还没有适合练流利度的短文"
              description="流利度练习要用已经读得懂的内容。先在分级阅读或听力工作室里读完一篇；做过水平诊断后，比你水平低的材料也会出现在这里。"
              action={
                <Button asChild variant="outline">
                  <Link href="/reading">去分级阅读</Link>
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {texts.map((t) => (
                <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span lang="en" className="font-semibold text-ink">
                        {t.titleEn}
                      </span>
                      <span className="text-sm text-muted">{t.titleZh}</span>
                    </div>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone="outline" size="sm">
                        {t.type === "reading" ? <BookOpen aria-hidden="true" /> : <Headphones aria-hidden="true" />}
                        {t.type === "reading" ? "阅读" : "听力"} · {t.levelLabel}
                      </Badge>
                      <Badge tone={t.why === "completed" ? "mint" : "blue"} size="sm">
                        {t.why === "completed" ? "读完过" : "比你的水平简单"}
                      </Badge>
                      <Badge size="sm">{t.wordCount} 词</Badge>
                      {t.practiceCount > 0 ? <Badge size="sm">练过 {t.practiceCount} 次</Badge> : null}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FLUENCY_KINDS.filter((k) => k !== "speed_reading" || t.questionCount > 0).map((k) => (
                      <Button key={k} asChild variant="soft" size="sm">
                        <Link href={`/fluency/${k}/${t.id}`} aria-label={`${FLUENCY_KIND_LABELS[k].zh}：${t.titleEn}`}>
                          {FLUENCY_KIND_LABELS[k].zh}
                        </Link>
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>本周流利度</CardTitle>
            <CardDescription>
              已练 {Math.round(weekMinutes)} 分钟，建议每周约 {target} 分钟。水平越高，流利度练习占的比例越大。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressBar value={Math.min(1, weekMinutes / target)} label={`本周流利度 ${Math.round(weekMinutes)} / ${target} 分钟`} tone="primary" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>阅读速度</CardTitle>
            <CardDescription>
              快速阅读每分钟读多少词（理解题答对 70% 以上的才算）。速度只和你自己比：坚持练，速度会慢慢上升。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {speed.points.length === 0 ? (
              <p className="text-muted">还没有记录。做一次快速阅读就会出现在这里。</p>
            ) : (
              <>
                <p className="text-ink">
                  最近 {Math.min(3, speed.points.length)} 次平均 <span className="text-lg font-semibold tabular-nums">{speed.recentAvg}</span> 词/分钟
                  {speed.earlierAvg !== null ? <span className="text-muted">（再之前 3 次：{speed.earlierAvg}）</span> : null}
                </p>
                <table className="w-full text-left">
                  <caption className="sr-only">最近的快速阅读速度</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-1 font-medium">
                        日期
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        词/分钟
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...speed.points].reverse().slice(0, 6).map((p) => (
                      <tr key={p.at.toISOString()} className="border-t border-border">
                        <td className="py-1.5 text-muted">{dateFmt(p.at, tz)}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums text-ink">{p.wpm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {speed.notCounted > 0 ? <p className="text-xs text-muted">另有 {speed.notCounted} 次理解不足 70%，没有计入速度：读得太快会读不懂，稍微放慢一点。</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近的练习</CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted">还没有流利度练习记录。</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {records.map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{FLUENCY_KIND_LABELS[r.kind as FluencyKind].zh}</span>
                      <span className="text-xs text-muted">{dateFmt(r.at, tz)}</span>
                    </span>
                    <span lang="en" className="text-muted">
                      {r.titleEn}
                    </span>
                    <span className="text-ink">{recordSummary(r)}</span>
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
