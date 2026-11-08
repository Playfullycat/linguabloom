import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ResultView } from "@/components/pte/result-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import type { PteWrittenFeedback } from "@/modules/pte/domain/feedback";
import type { ItemMark } from "@/modules/pte/domain/scoring";
import { PteNotFoundError, getAttempt, type Reveal } from "@/modules/pte/services/pte";

export const metadata: Metadata = { title: "PTE attempt" };

type Snapshot = { taskNameZh: string; taskNameEn: string; scoringRuleZh: string; promptTitleZh: string; reveal: Reveal };

export default function PteAttemptPage({ params }: PageProps<"/pte/attempts/[attemptId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <AttemptLoader params={params} />
    </Suspense>
  );
}

/** A past attempt, shown from its own snapshot — later versions or edited prompts don't change it. */
async function AttemptLoader({ params }: Pick<PageProps<"/pte/attempts/[attemptId]">, "params">) {
  const { attemptId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const user = await requireOwner();
  const db = getDb();
  const data = await getAttempt(db, user.id, attemptId).catch((e: unknown) => {
    if (e instanceof PteNotFoundError) return null;
    throw e;
  });
  if (!data) notFound();
  const { attempt: a, version } = data;
  const snap = a.snapshot as Snapshot;
  const detail = (a.scoreDetail as { marks?: ItemMark[]; form?: { words: number; status: "ok" | "outside_target" | "zero" } | null } | null) ?? {};
  const { profile } = await getLearnerSettings(db, user.id);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/pte/${a.taskCode}`} className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {snap.taskNameZh}
          </Link>
        }
        title={snap.promptTitleZh}
        titleZh={snap.taskNameEn}
        description={`${a.createdAt.toLocaleString("zh-CN", { timeZone: profile.timezone })} · ${a.mode === "timed" ? "计时模式" : "练习模式"}${a.timedOut ? "（时间到自动提交）" : ""}`}
      />
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap gap-1.5" data-testid="attempt-version">
            <Badge size="sm" tone="outline">
              考试版本：{version.labelZh}
            </Badge>
            <Badge size="sm" tone="outline">
              题目第 {a.promptVersion} 版
            </Badge>
            {a.durationMs !== null ? <Badge size="sm">用时 {Math.round(a.durationMs / 1000)} 秒</Badge> : null}
          </div>
          <ResultView
            result={{ score: a.score, maxScore: a.maxScore, marks: detail.marks ?? [], form: detail.form ?? null, feedback: (a.feedback as PteWrittenFeedback | null) ?? null, feedbackMessage: null, reveal: snap.reveal }}
            scoringRule={snap.scoringRuleZh}
          />
        </CardContent>
      </Card>
    </>
  );
}
