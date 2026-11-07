import { BookA, Download, RotateCcw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SpeakButton } from "@/components/media/speak-button";
import { VocabularyStatusBadge } from "@/components/review/vocabulary-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { VOCABULARY_STATUSES } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { describeDueIn } from "@/lib/time";
import { cn } from "@/lib/utils";
import { spokenText } from "@/modules/review/domain/cards";
import { STATUS_LABELS } from "@/modules/review/domain/status";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { getReviewStats, listVocabulary } from "@/modules/review/services/review";

export const metadata: Metadata = { title: "Vocabulary" };

export default function VocabularyPage({ searchParams }: PageProps<"/vocabulary">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <BookA className="size-4" aria-hidden="true" />
            <span lang="en">Learn</span> · 学习
          </span>
        }
        title="Vocabulary"
        titleZh="词汇"
        description="分开看“看得懂”和“用得出”。学完课程的词会自动加入这里，并按 FSRS 安排复习。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/vocabulary" download>
                <Download aria-hidden="true" />
                导出词汇
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/review-logs" download>
                <Download aria-hidden="true" />
                导出复习记录
              </a>
            </Button>
          </>
        }
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载词汇…" />}>
        <VocabularyContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4 sm:p-5">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-2xl font-semibold tabular-nums text-ink">{value}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

async function VocabularyContent({ searchParams }: Pick<PageProps<"/vocabulary">, "searchParams">) {
  const params = await searchParams;
  const status = typeof params.status === "string" && (VOCABULARY_STATUSES as readonly string[]).includes(params.status) ? params.status : undefined;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 60) : "";

  const user = await requireOwner();
  const db = getDb();
  const now = new Date();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const [stats, words] = await Promise.all([
    getReviewStats(db, user.id, now, profile.timezone),
    listVocabulary(db, user.id, { status, q: q || undefined }),
  ]);

  if (stats.totalWords === 0) {
    return (
      <EmptyState
        icon={BookA}
        title="词汇库还是空的"
        description="学完一节课，课里的新词会自动加入词汇库，并生成“英 → 义”和“义 → 英”两张复习卡。"
        action={
          <Button asChild>
            <Link href="/learn/path">去学一节课</Link>
          </Button>
        }
      />
    );
  }

  const recognised = (stats.byStatus.receptive_known ?? 0) + (stats.byStatus.productive_developing ?? 0) + (stats.byStatus.productive_known ?? 0);
  const minReviews = 10;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="词汇总数" value={stats.totalWords} />
        <Stat label="看得懂" value={recognised} hint="被动识别已稳定" />
        <Stat label="会用了" value={stats.byStatus.productive_known ?? 0} hint="能稳定写出来" />
        <Stat
          label="现在到期"
          value={stats.dueNow}
          hint={
            stats.overdue > 0
              ? `其中 ${stats.overdue} 张已逾期`
              : stats.newWaiting > 0
                ? `另有 ${stats.newWaiting} 张新卡待学`
                : `今天已复习 ${stats.reviewsToday} 次`
          }
        />
        <Stat label="困难词" value={stats.difficultWords} hint="反复忘记的词" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-ink">看得懂 vs 用得出</h2>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-ink">被动识别稳定度</span>
                <span className="tabular-nums text-muted">{Math.round(stats.receptiveAverage * 100)}%</span>
              </div>
              <ProgressBar value={stats.receptiveAverage} label="被动识别稳定度" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-ink">主动回忆稳定度</span>
                <span className="tabular-nums text-muted">{Math.round(stats.productiveAverage * 100)}%</span>
              </div>
              <ProgressBar value={stats.productiveAverage} label="主动回忆稳定度" tone="mint" />
            </div>
            <p className="text-xs text-muted">
              按记忆稳定性估算：识别卡稳定 {7} 天、产出卡稳定 {21} 天记为 100%。两者的差距就是“认识但还不会用”的部分。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink">保持率（已学会的卡片复习时仍记得的比例）</h2>
            <ul className="grid grid-cols-3 gap-2">
              {stats.retention.map((r) => (
                <li key={r.days} className="flex flex-col rounded-xl bg-surface-soft p-3">
                  <span className="text-xs text-muted">最近 {r.days} 天</span>
                  <span className="text-lg font-semibold tabular-nums text-ink">
                    {r.rate !== null && r.reviews >= minReviews ? `${Math.round(r.rate * 100)}%` : "—"}
                  </span>
                  <span className="text-xs text-muted">{r.reviews >= minReviews ? `${r.reviews} 次复习` : `数据不足（${r.reviews} 次）`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">至少 {minReviews} 次复习后才显示比例，避免少量数据误导。目标保持率约 90%。</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="按状态筛选" className="flex flex-wrap gap-1.5">
            {[undefined, ...VOCABULARY_STATUSES].map((s) => {
              const active = s === status;
              const href = s ? `/vocabulary?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}` : q ? `/vocabulary?q=${encodeURIComponent(q)}` : "/vocabulary";
              const count = s ? (stats.byStatus[s] ?? 0) : stats.totalWords;
              if (s && count === 0) return null;
              return (
                <Link
                  key={s ?? "all"}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active ? "border-primary bg-primary-soft text-primary-ink" : "border-border text-muted hover:bg-surface-soft hover:text-ink",
                  )}
                >
                  {s ? STATUS_LABELS[s] : "全部"} <span className="tabular-nums">{count}</span>
                </Link>
              );
            })}
          </nav>
          <form action="/vocabulary" className="flex gap-2" role="search">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <label htmlFor="vocab-search" className="sr-only">
              搜索词汇
            </label>
            <Input id="vocab-search" name="q" defaultValue={q} placeholder="搜索英文或中文" className="h-10 sm:w-56" />
            <Button type="submit" variant="outline" size="sm" className="h-10">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索</span>
            </Button>
          </form>
        </div>

        {words.length === 0 ? (
          <EmptyState icon={Search} title="没有符合条件的词" description="换个关键词，或者查看全部词汇。" />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {words.map((w) => (
                <li key={w.entryId} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                  <SpeakButton text={spokenText(w.text)} label={`朗读：${w.text}`} />
                  <Link href={`/vocabulary/${encodeURIComponent(w.entryId)}`} className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline-offset-4 sm:flex-row sm:items-baseline sm:gap-3">
                    <span lang="en" className="font-medium text-ink">{w.text}</span>
                    <span className="truncate text-sm text-muted">{w.zh}</span>
                  </Link>
                  <span className="hidden text-xs text-muted tabular-nums sm:inline">
                    {w.nextDueAt ? `下次：${describeDueIn(new Date(w.nextDueAt), now)}` : "已暂停"}
                  </span>
                  <VocabularyStatusBadge status={w.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {stats.dueNow > 0 || stats.newWaiting > 0 ? (
        <div className="flex justify-center">
          <Button asChild size="lg">
            <Link href="/review">
              <RotateCcw aria-hidden="true" />
              {stats.dueNow > 0 ? `开始复习（${stats.dueNow} 张到期）` : "开始学习新卡片"}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
