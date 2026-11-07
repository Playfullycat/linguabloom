import { BookA, ChartLine, ClipboardCheck, Info, Layers, NotebookPen, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { DIAGNOSTIC_SKILLS, DIAGNOSTIC_SKILL_LABELS } from "@/modules/assessment/content";
import { getCurrentEstimates } from "@/modules/assessment/services/assessment";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { listLevels } from "@/modules/curriculum/services/queries";
import { listErrors } from "@/modules/errors/services/errors";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { STATUS_LABELS, type VocabularyStatusValue } from "@/modules/review/domain/status";
import { getReviewStats } from "@/modules/review/services/review";
import { STRAND_LABELS, type Strand } from "@/modules/study-plan/domain/session-templates";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";

export const metadata: Metadata = { title: "Progress" };

const CONFIDENCE_LABELS: Record<string, string> = { low: "把握较低", medium: "把握中等", high: "把握较高" };
const STRANDS: Strand[] = ["language_focused_learning", "meaning_focused_input", "meaning_focused_output", "fluency_development"];
const STATUS_ORDER: VocabularyStatusValue[] = ["new", "learning", "receptive_known", "productive_developing", "productive_known", "difficult", "suspended"];

export default function ProgressPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ChartLine className="size-4" aria-hidden="true" />
            <span lang="en">Progress</span> · 进度
          </span>
        }
        title="Progress"
        titleZh="进度"
        description="所有数字都来自你真实的练习和复习记录。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在统计…" />}>
        <ProgressLoader />
      </Suspense>
    </>
  );
}

function SectionIcon({ icon: Icon, tone }: { icon: typeof ChartLine; tone: string }) {
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}>
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}

async function ProgressLoader() {
  const user = await requireOwner();
  const db = getDb();
  const now = new Date();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const tz = profile.timezone;
  const [estimates, levels, stats, week, errors] = await Promise.all([
    getCurrentEstimates(db, user.id),
    listLevels(db, user.id),
    getReviewStats(db, user.id, now, tz),
    getWeeklyActivity(db, user.id, now, tz),
    listErrors(db, user.id),
  ]);
  const openErrors = errors.filter((e) => e.status !== "resolved");
  const byCategory = [...openErrors.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + e.occurrenceCount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const weakPoints = openErrors.filter((e) => e.pointType === "grammar").slice(0, 5);
  const label = (level: string) => (isCefrLevel(level) ? CEFR_LEVEL_LABELS[level] : level);
  const lessonsDone = levels.reduce((s, l) => s + l.completedLessonCount, 0);
  const lessonsTotal = levels.reduce((s, l) => s + l.lessonCount, 0);
  const gap = stats.receptiveAverage - stats.productiveAverage;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={ClipboardCheck} tone="bg-primary-soft text-primary-ink" />
          <div className="flex-1">
            <CardTitle>各技能的估计水平</CardTitle>
            <CardDescription>每项都标明把握程度和依据的题数。</CardDescription>
          </div>
          <Button asChild variant="soft" size="sm">
            <Link href="/assessment">{estimates.length > 0 ? "诊断详情" : "做水平诊断"}</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DIAGNOSTIC_SKILLS.map((skill) => {
              const e = estimates.find((x) => x.skill === skill);
              return (
                <li key={skill} className="rounded-2xl bg-surface-soft p-4">
                  <p className="text-sm text-muted">{DIAGNOSTIC_SKILL_LABELS[skill]}</p>
                  {e ? (
                    <>
                      <p className="mt-1 text-2xl font-semibold text-ink">约 {label(e.level)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge size="sm" tone={e.confidence === "low" ? "yellow" : "blue"}>
                          {CONFIDENCE_LABELS[e.confidence] ?? e.confidence}
                        </Badge>
                        <Badge size="sm">依据 {e.evidenceCount} 题</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {e.source.startsWith("assessment:") ? "来自水平诊断" : e.source === "practice" ? "来自练习记录" : e.source} · {e.createdAt.toLocaleDateString("zh-CN", { timeZone: tz })}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted">还没有足够的记录</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-2 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            这些是根据诊断和练习记录的估计（语法看语法练习，阅读和听力看理解题），用来安排学习内容，不是官方 CEFR 认证。口语和写作的估计要等 AI 反馈上线（Phase 3）。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={Layers} tone="bg-primary-soft text-primary-ink" />
          <div>
            <CardTitle>课程</CardTitle>
            <CardDescription>
              已完成 {lessonsDone} / {lessonsTotal} 节已发布的课
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {levels
              .filter((l) => l.lessonCount > 0)
              .map((l) => (
                <li key={l.code} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-ink">{l.label}</span>
                    <span className="text-muted">
                      {l.completedLessonCount} / {l.lessonCount}
                    </span>
                  </div>
                  <ProgressBar value={l.lessonCount === 0 ? 0 : l.completedLessonCount / l.lessonCount} label={`${l.label} 课程完成度`} />
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={BookA} tone="bg-mint-soft text-mint-ink" />
          <div>
            <CardTitle>词汇</CardTitle>
            <CardDescription>词汇库里共 {stats.totalWords} 个词</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {stats.totalWords === 0 ? (
            <p className="text-sm text-muted">学完一节课后，这里会显示“看得懂”和“用得出”的差距。</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink">看得懂（被动）</span>
                  <span className="text-muted">{pct(stats.receptiveAverage)}</span>
                </div>
                <ProgressBar value={stats.receptiveAverage} label="被动掌握" />
                <div className="flex justify-between text-sm">
                  <span className="text-ink">用得出（主动）</span>
                  <span className="text-muted">{pct(stats.productiveAverage)}</span>
                </div>
                <ProgressBar value={stats.productiveAverage} label="主动掌握" tone="mint" />
                <p className="text-xs text-muted">
                  {gap > 0.15 ? `差距 ${pct(gap)}：多做拼写、语境填空和口语任务，把认识的词变成会用的词。` : "两者差距不大，继续保持。"}
                </p>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {STATUS_ORDER.filter((s) => (stats.byStatus[s] ?? 0) > 0).map((s) => (
                  <li key={s}>
                    <Badge size="sm">
                      {STATUS_LABELS[s]} {stats.byStatus[s]}
                    </Badge>
                  </li>
                ))}
              </ul>
              <div>
                <p className="text-sm font-medium text-ink">保留率（已学会的卡片复习时没忘的比例）</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  {stats.retention.map((r) => (
                    <div key={r.days} className="rounded-xl bg-surface-soft px-3 py-2">
                      <dt className="text-muted">近 {r.days} 天</dt>
                      <dd className="font-medium text-ink">{r.rate === null ? "—" : pct(r.rate)}</dd>
                      <dd className="text-xs text-muted">{r.reviews} 次复习</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={NotebookPen} tone="bg-coral-soft text-coral-ink" />
          <div className="flex-1">
            <CardTitle>错误类型与语法薄弱点</CardTitle>
            <CardDescription>
              未解决的错误 {openErrors.length} 条，已解决 {errors.length - openErrors.length} 条。
            </CardDescription>
          </div>
          <Button asChild variant="soft" size="sm">
            <Link href="/errors">打开错误本</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {openErrors.length === 0 ? (
            <p className="text-sm text-muted">{errors.length === 0 ? "还没有错误记录。做错的题会自动归类到这里。" : "目前没有未解决的错误。"}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ul className="flex flex-col gap-2" aria-label="错误类型">
                {byCategory.map(([cat, n]) => (
                  <li key={cat} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink">{ERROR_CATEGORY_LABELS[cat as keyof typeof ERROR_CATEGORY_LABELS] ?? cat}</span>
                      <span className="text-muted">{n} 次</span>
                    </div>
                    <ProgressBar value={n / byCategory[0]![1]} label={`${ERROR_CATEGORY_LABELS[cat as keyof typeof ERROR_CATEGORY_LABELS] ?? cat} 出错次数`} />
                  </li>
                ))}
              </ul>
              <div>
                <p className="mb-2 text-sm font-medium text-ink">语法薄弱点</p>
                {weakPoints.length === 0 ? (
                  <p className="text-sm text-muted">没有未解决的语法错误。</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {weakPoints.map((w) => (
                      <li key={w.id}>
                        <Link href={`/grammar/${w.pointId}`} className="text-sm text-primary-ink hover:underline">
                          {w.title}（出现 {w.occurrenceCount} 次）
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={Timer} tone="bg-blue-soft text-blue-ink" />
          <div>
            <CardTitle>最近 7 天的学习时间</CardTitle>
            <CardDescription>
              共 {Math.round(week.totalMinutes)} 分钟，按“四个支柱”分类。单条记录超过上限的部分不计入（避免页面开着没学也算时间）。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STRANDS.map((s) => (
              <li key={s} className="flex flex-col gap-1.5 rounded-2xl bg-surface-soft p-4">
                <span className="text-sm text-muted">{STRAND_LABELS[s]}</span>
                <span className="text-xl font-semibold text-ink">{Math.round(week.byStrand[s])} 分钟</span>
                <ProgressBar value={week.totalMinutes === 0 ? 0 : week.byStrand[s] / week.totalMinutes} label={`${STRAND_LABELS[s]} 占比`} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
