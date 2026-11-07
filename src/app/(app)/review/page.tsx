import { CalendarCheck, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ReviewSession } from "@/components/review/review-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getReviewQueue, getReviewStats } from "@/modules/review/services/review";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="Review"
        titleZh="复习"
        description="先努力回想，再看答案。系统用 FSRS 算法安排下一次出现的时间：越熟的词，间隔越长。"
      />
      <div className="mx-auto w-full max-w-2xl">
        <Suspense fallback={<LoadingSkeleton label="正在准备复习…" />}>
          <ReviewLoader />
        </Suspense>
      </div>
    </>
  );
}

async function ReviewLoader() {
  const user = await requireOwner();
  const db = getDb();
  const now = new Date();
  const tz = getEnv().DEFAULT_TIMEZONE;
  const [queue, stats] = await Promise.all([getReviewQueue(db, user.id, now, tz), getReviewStats(db, user.id, now, tz)]);

  if (queue.cards.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title={stats.totalWords === 0 ? "词汇库还是空的" : "现在没有需要复习的卡片"}
        description={
          stats.totalWords === 0
            ? "学完一节课，课里的词会自动加入词汇库，并在这里出现。"
            : queue.newWaiting > 0
              ? `今天的新词额度（${queue.newBudget} 个）已经用完，还有 ${queue.newWaiting} 张新卡明天开始。到期的复习都完成了。`
              : "到期的复习都完成了。下一批会在它们快要被忘记的时候出现。"
        }
        action={
          <Button asChild variant="soft">
            <Link href={stats.totalWords === 0 ? "/learn/path" : "/vocabulary"}>{stats.totalWords === 0 ? "去学一节课" : "查看词汇库"}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone="primary">本轮 {queue.cards.length} 张</Badge>
        {stats.dueNow > 0 ? <Badge tone="yellow">到期复习 {stats.dueNow}</Badge> : null}
        {queue.cards.some((c) => c.isNew) ? <Badge tone="blue">新词 {queue.cards.filter((c) => c.isNew).length}</Badge> : null}
      </div>
      <ReviewSession initialCards={queue.cards} />
    </div>
  );
}
