import { BookA, BookOpen, ChartLine, ClipboardCheck, Info, Layers, Mic, NotebookPen, Target, Timer, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SkillTrendChart, type TrendSeries } from "@/components/abilities/skill-trend-chart";
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
import { getAbilityMap, summarizeAbilities } from "@/modules/abilities/services/abilities";
import { getSkillAnalytics } from "@/modules/abilities/services/analytics";
import { getCurrentEstimates, getEstimateHistory } from "@/modules/assessment/services/assessment";
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
  const [estimates, levels, stats, week, errors, history, abilities, analytics] = await Promise.all([
    getCurrentEstimates(db, user.id),
    listLevels(db, user.id),
    getReviewStats(db, user.id, now, tz),
    getWeeklyActivity(db, user.id, now, tz),
    listErrors(db, user.id),
    getEstimateHistory(db, user.id),
    getAbilityMap(db, user.id, tz, now),
    getSkillAnalytics(db, user.id, now),
  ]);
  const sourceLabel = (src: string) => (src.startsWith("assessment:") ? "水平诊断" : src === "practice" ? "练习记录" : src === "ai_writing" ? "AI 写作反馈" : src);
  const trend: TrendSeries[] = [...DIAGNOSTIC_SKILLS, "writing" as const].map((skill) => ({
    skill,
    label: skill === "writing" ? "写作" : DIAGNOSTIC_SKILL_LABELS[skill],
    points: history
      .filter((h) => h.skill === skill)
      .map((h) => ({ at: h.createdAt.toISOString(), level: h.level, levelLabel: isCefrLevel(h.level) ? CEFR_LEVEL_LABELS[h.level] : h.level, source: sourceLabel(h.source), confidence: CONFIDENCE_LABELS[h.confidence] ?? h.confidence, evidence: h.evidenceCount })),
  }));
  const abilitySummary = summarizeAbilities(abilities);
  const rate = (c: number, n: number) => (n === 0 ? "—" : `${Math.round((c / n) * 100)}%`);
  const writingCats = [...new Set([...Object.keys(analytics.writing.earlier), ...Object.keys(analytics.writing.recent)])].sort(
    (a, b) => (analytics.writing.recent[b] ?? 0) + (analytics.writing.earlier[b] ?? 0) - ((analytics.writing.recent[a] ?? 0) + (analytics.writing.earlier[a] ?? 0)),
  );
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
            {[...DIAGNOSTIC_SKILLS, ...(estimates.some((x) => x.skill === "writing") ? (["writing"] as const) : [])].map((skill) => {
              const e = estimates.find((x) => x.skill === skill);
              return (
                <li key={skill} className="rounded-2xl bg-surface-soft p-4">
                  <p className="text-sm text-muted">{skill === "writing" ? "写作" : DIAGNOSTIC_SKILL_LABELS[skill]}</p>
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
                        {e.source.startsWith("assessment:") ? "来自水平诊断" : e.source === "practice" ? "来自练习记录" : e.source === "ai_writing" ? "来自 AI 写作反馈" : e.source} · {e.createdAt.toLocaleDateString("zh-CN", { timeZone: tz })}
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
            这些是根据诊断和练习记录的估计（语法看语法练习，阅读和听力看理解题），用来安排学习内容，不是官方 CEFR 认证。写作估计来自至少 3 篇把握中等以上的 AI 反馈，所以一律标为“把握较低”。口语暂时不给等级估计，只记录任务完成情况（见下方）。
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={TrendingUp} tone="bg-primary-soft text-primary-ink" />
          <div className="flex-1">
            <CardTitle>技能估计的变化</CardTitle>
            <CardDescription>每次诊断和练习更新都会留下一条记录，旧的不会被覆盖。</CardDescription>
          </div>
          <Button asChild variant="soft" size="sm">
            <Link href="/assessment">评估历史</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <SkillTrendChart series={trend} now={now.toISOString()} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={Target} tone="bg-mint-soft text-mint-ink" />
          <div className="flex-1">
            <CardTitle>能力地图</CardTitle>
            <CardDescription>每条能力描述都要用真实练习证明；“已展示”需要在不同的日子里多次做到。</CardDescription>
          </div>
          <Button asChild variant="soft" size="sm">
            <Link href="/progress/abilities">打开能力地图</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="ability-summary">
            {abilitySummary.map((l) => (
              <li key={l.level}>
                <Link href={`/progress/abilities?level=${l.level}`} className="flex flex-col gap-1.5 rounded-2xl bg-surface-soft p-4 hover:bg-surface-soft/70 focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="text-sm text-muted">{label(l.level)}</span>
                  <span className="text-xl font-semibold text-ink">
                    {l.shown} / {l.total} <span className="text-sm font-normal text-muted">已展示</span>
                  </span>
                  <ProgressBar value={l.total === 0 ? 0 : l.shown / l.total} label={`${label(l.level)} 已展示的能力`} tone="mint" />
                  <span className="text-xs text-muted">
                    有证据 {l.emerging} 条{l.stale > 0 ? ` · ${l.stale} 条很久没练` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={BookOpen} tone="bg-blue-soft text-blue-ink" />
          <div>
            <CardTitle>阅读与听力理解</CardTitle>
            <CardDescription>理解题的正确率，按材料等级分开看。</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4" data-testid="comprehension">
          {(["reading", "listening"] as const).map((k) => {
            const a = analytics[k];
            const name = k === "reading" ? "阅读" : "听力";
            return (
              <div key={k} className="flex flex-col gap-2">
                <p className="text-sm font-medium text-ink">
                  {name}：正确率 {rate(a.correct, a.answered)}
                  <span className="font-normal text-muted">
                    （共 {a.answered} 题；近 30 天 {rate(a.recentCorrect, a.recentAnswered)}，{a.recentAnswered} 题）
                  </span>
                </p>
                {a.byLevel.length === 0 ? (
                  <p className="text-sm text-muted">还没有做过{name}理解题。</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {a.byLevel.map((r) => (
                      <li key={r.level} className="flex flex-col gap-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-ink">{label(r.level)} 材料</span>
                          <span className="text-muted">
                            {rate(r.correct, r.answered)} · {r.answered} 题
                          </span>
                        </div>
                        <ProgressBar value={r.answered === 0 ? 0 : r.correct / r.answered} label={`${label(r.level)} ${name}正确率`} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted">
            读完的阅读材料 {analytics.reading.completed} 篇
            {analytics.listening.replaysPerMaterial !== null ? ` · 听力平均每份材料重放 ${analytics.listening.replaysPerMaterial} 次` : ""}
            {analytics.listening.dictation.attempts > 0 ? ` · 听写完全正确 ${rate(analytics.listening.dictation.correct, analytics.listening.dictation.attempts)}（${analytics.listening.dictation.attempts} 句）` : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <SectionIcon icon={Mic} tone="bg-coral-soft text-coral-ink" />
          <div>
            <CardTitle>口语与写作</CardTitle>
            <CardDescription>口语看任务完成情况；写作看错误类别有没有减少。</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4" data-testid="output-skills">
          {analytics.speaking.sessions === 0 ? (
            <p className="text-sm text-muted">还没有完成过口语练习。</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              <p className="font-medium text-ink">
                口语：{analytics.speaking.sessions} 次练习，约 {analytics.speaking.minutes} 分钟
              </p>
              <p className="text-muted">
                有反馈的 {analytics.speaking.withFeedback} 次中：完成任务 {analytics.speaking.met} 次，部分完成 {analytics.speaking.partly} 次，未完成 {analytics.speaking.notMet} 次
              </p>
              {analytics.speaking.wordsPerTurn !== null ? <p className="text-muted">平均每次开口约 {analytics.speaking.wordsPerTurn} 个词（越长说明能连着说的越多）</p> : null}
            </div>
          )}
          {analytics.writing.earlierCount === 0 ? (
            <p className="text-sm text-muted">有 2 篇带反馈的文章后，这里会比较早期和最近的错误类别。</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              <p className="font-medium text-ink">
                写作：最早 {analytics.writing.earlierCount} 篇 vs 最近 {analytics.writing.recentCount} 篇的语法问题
              </p>
              {writingCats.length === 0 ? (
                <p className="text-muted">这些文章里都没有标出语法问题。</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-medium">类别</th>
                      <th className="py-1 text-right font-medium">早期</th>
                      <th className="py-1 text-right font-medium">最近</th>
                    </tr>
                  </thead>
                  <tbody>
                    {writingCats.slice(0, 6).map((c) => {
                      const before = analytics.writing.earlier[c] ?? 0;
                      const after = analytics.writing.recent[c] ?? 0;
                      return (
                        <tr key={c} className="border-t border-border">
                          <td className="py-1 text-ink">{ERROR_CATEGORY_LABELS[c as keyof typeof ERROR_CATEGORY_LABELS] ?? c}</td>
                          <td className="py-1 text-right tabular-nums">{before}</td>
                          <td className="py-1 text-right tabular-nums">
                            {after} <span className="text-xs text-muted">{after < before ? "↓ 减少" : after > before ? "↑ 增加" : "持平"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
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
