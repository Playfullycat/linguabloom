import { ClipboardCheck, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AssessmentRunner } from "@/components/assessment/assessment-runner";
import { StartAssessmentButton } from "@/components/assessment/start-assessment-button";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { DIAGNOSTIC_SKILLS, DIAGNOSTIC_SKILL_LABELS } from "@/modules/assessment/content";
import { SELF_REPORT_LABELS, type SelfReportedLevel } from "@/modules/assessment/domain/engine";
import {
  getActiveSession,
  getAssessmentState,
  getCurrentEstimates,
  getLatestCompletedSession,
} from "@/modules/assessment/services/assessment";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { placementLevel } from "@/modules/study-plan/services/plan";

export const metadata: Metadata = { title: "Placement check" };

const CONFIDENCE_LABELS: Record<string, string> = { low: "把握较低", medium: "把握中等", high: "把握较高" };

export default function AssessmentPage({ searchParams }: PageProps<"/assessment">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ClipboardCheck className="size-4" aria-hidden="true" />
            <span lang="en">Placement</span> · 水平诊断
          </span>
        }
        title="Placement check"
        titleZh="水平诊断"
        description="找到合适的起点，而不是给你贴标签。结果是初步估计，会随着练习记录更新。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在准备诊断…" />}>
        <AssessmentLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AssessmentLoader({ searchParams }: { searchParams: PageProps<"/assessment">["searchParams"] }) {
  const { from } = await searchParams;
  const user = await requireOwner();
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const fromOnboarding = from === "onboarding" || profile.onboardingCompletedAt === null;
  const pauseHref = fromOnboarding ? "/onboarding" : "/today";

  const active = await getActiveSession(db, user.id);
  if (active) {
    const state = await getAssessmentState(db, user.id, active.id);
    return <AssessmentRunner key={active.id} initial={state} pauseHref={pauseHref} />;
  }

  const completed = await getLatestCompletedSession(db, user.id);
  if (!completed) {
    const selfReport = profile.selfReportedLevel as SelfReportedLevel | null;
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>开始前须知</CardTitle>
          <CardDescription>词汇、语法、阅读、听力四部分，共约 20 题、10–15 分钟。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1.5 text-sm text-ink">
            <li>· 题目会根据你的回答变难或变简单，不会一直出很难的题。</li>
            <li>· 不会就点“不会”，不用猜。猜对反而会让起点偏高。</li>
            <li>· 每一部分都能跳过；中途离开，下次从原处继续。</li>
            <li>· 口语和写作是选做部分，最后再说。</li>
          </ul>
          <p className="text-sm text-muted">
            起始难度：{selfReport ? `按你的自评“${SELF_REPORT_LABELS[selfReport]}”` : "从 A1 开始（可以在引导里填写自评）"}。
          </p>
          <StartAssessmentButton label="开始诊断" />
        </CardContent>
      </Card>
    );
  }

  const estimates = await getCurrentEstimates(db, user.id);
  const fromThisSession = estimates.filter((e) => e.source === `assessment:${completed.id}`);
  const placement = placementLevel(fromThisSession);
  const label = (level: string) => (isCefrLevel(level) ? CEFR_LEVEL_LABELS[level] : level);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>初步结果</CardTitle>
          <CardDescription>
            {completed.completedAt ? `完成于 ${completed.completedAt.toLocaleDateString("zh-CN", { timeZone: profile.timezone })}。` : null}
            每项都写明了依据多少道题；题目越少，估计越粗。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="grid gap-3 sm:grid-cols-2">
            {DIAGNOSTIC_SKILLS.map((skill) => {
              const e = fromThisSession.find((x) => x.skill === skill);
              return (
                <li key={skill} className="rounded-2xl bg-surface-soft p-4">
                  <p className="text-sm text-muted">{DIAGNOSTIC_SKILL_LABELS[skill]}</p>
                  {e ? (
                    <>
                      <p className="mt-1 text-2xl font-semibold text-ink">约 {label(e.level)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={e.confidence === "low" ? "yellow" : "blue"}>{CONFIDENCE_LABELS[e.confidence] ?? e.confidence}</Badge>
                        <Badge>依据 {e.evidenceCount} 题</Badge>
                      </div>
                      {e.mayBeHigher ? <p className="mt-2 text-xs text-muted">最难的题都答对了，实际水平可能更高。</p> : null}
                    </>
                  ) : (
                    <p className="mt-1 text-[0.9375rem] text-muted">这部分跳过了，暂无估计。</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-2 rounded-2xl bg-blue-soft p-4 text-sm text-blue-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            这是根据少量题目得出的初步估计，不是官方 CEFR 认证，也不代表最终水平。之后的课程和复习记录会让它越来越准。
          </p>
          {placement ? (
            <p className="text-[0.9375rem] text-ink">
              建议起点：<span className="font-semibold">{label(placement)}</span>（取词汇和语法中较低的一项，先把基础打牢）。
            </p>
          ) : (
            <p className="text-[0.9375rem] text-ink">词汇和语法都跳过了，先从第一课开始；以后可以随时重新诊断。</p>
          )}
          {completed.writingSample ? (
            <div className="rounded-2xl border border-border p-4">
              <p className="text-sm text-muted">你的写作样本（未评分，留作以后对比）</p>
              <p lang="en" className="mt-1 whitespace-pre-wrap text-[0.9375rem] text-ink">
                {completed.writingSample}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href={fromOnboarding ? "/onboarding" : "/today"}>{fromOnboarding ? "看看第一周计划" : "回到今日"}</Link>
            </Button>
            <StartAssessmentButton label="重新诊断" variant="outline" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
