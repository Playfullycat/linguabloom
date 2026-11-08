import { ArrowLeft, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { MockRunner } from "@/components/pte/mock-runner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { aiStatus } from "@/modules/ai/provider";
import { speechAvailable } from "@/modules/audio/tts-cache";
import { SECTION_LABELS } from "@/modules/pte/content";
import { REPORT_SKILL_LABELS } from "@/modules/pte/services/report";
import { getMockResult, getMockState } from "@/modules/pte/services/mock";
import { PteNotFoundError, getCurrentVersion, getPracticeItem, getTaskType } from "@/modules/pte/services/pte";

export const metadata: Metadata = { title: "PTE mock test" };

export default function PteMockPage({ params }: PageProps<"/pte/mock/[mockId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在准备模拟练习…" />}>
      <MockLoader params={params} />
    </Suspense>
  );
}

async function MockLoader({ params }: Pick<PageProps<"/pte/mock/[mockId]">, "params">) {
  const { mockId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(mockId)) notFound();
  const user = await requireOwner();
  const db = getDb();
  const state = await getMockState(db, user.id, mockId).catch((e: unknown) => {
    if (e instanceof PteNotFoundError) return null;
    throw e;
  });
  if (!state) notFound();
  const header = (
    <PageHeader
      eyebrow={
        <Link href="/pte" className="inline-flex items-center gap-1.5 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          PTE 专区
        </Link>
      }
      title="Mini mock test"
      titleZh={`迷你模拟 · ${SECTION_LABELS[state.section]}`}
      description="每个题型一道题，按整个部分计时。时间是各题时间相加（官方有单题时间的用官方时间），不是完整的模拟考试。"
    />
  );

  if (state.status === "in_progress" && state.currentIndex !== null) {
    const current = state.items[state.currentIndex]!;
    const item = await getPracticeItem(db, current.promptId);
    const version = await getCurrentVersion(db);
    const type = await getTaskType(db, version.id, current.taskCode);
    const status = aiStatus();
    const audioSource = !speechAvailable() ? "browser" : status.available && status.simulated ? "simulated" : "provider";
    return (
      <>
        {header}
        <Card className="max-w-3xl">
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{type.nameZh}</Badge>
              <span lang="en" className="text-sm text-muted">
                {type.nameEn}
              </span>
            </div>
            <p className="text-sm text-muted">{type.descriptionZh}</p>
            <MockRunner key={state.currentIndex} state={state} item={item} scoringRule={type.scoring.rule_zh ?? type.scoring.official_zh} audioSource={audioSource} />
          </CardContent>
        </Card>
      </>
    );
  }

  const result = await getMockResult(db, user.id, mockId);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <>
      {header}
      <div className="grid max-w-4xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>结果</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4" data-testid="mock-result">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone={state.endReason === "time_up" ? "yellow" : "mint"}>{state.endReason === "time_up" ? "时间到，自动结束" : "已完成"}</Badge>
              <Badge tone="outline">
                作答 {result.answered} / {result.items.length} 题
              </Badge>
              <Badge tone="outline">
                用时 {Math.floor(state.elapsedSeconds / 60)} 分 {state.elapsedSeconds % 60} 秒 / 限时 {Math.round(state.timeLimitSeconds / 60)} 分钟
              </Badge>
            </div>
            {result.objectiveShare !== null ? (
              <p className="text-[0.9375rem] text-ink">
                客观题平均得分率：<span className="font-semibold" data-testid="mock-share">{pct(result.objectiveShare)}</span>
                <span className="text-sm text-muted">（没作答的客观题按 0 计）</span>
              </p>
            ) : null}
            {result.bySkill.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {result.bySkill.map((s) => (
                  <li key={s.skill} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink">{REPORT_SKILL_LABELS[s.skill as keyof typeof REPORT_SKILL_LABELS] ?? s.skill}</span>
                      <span className="text-muted">
                        {pct(s.share)} · {s.items} 题
                      </span>
                    </div>
                    <ProgressBar value={s.share} label={`${s.skill} 得分率`} />
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="flex items-start gap-2 rounded-xl bg-blue-soft p-3 text-sm text-blue-ink">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              这是原创练习题上的得分率，口语和写作题只有 AI 辅助反馈、不计分。它不能换算成 PTE 分数，也不是对考试成绩的预测。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>每道题</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {result.items.map((i) => (
                <li key={i.promptId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-soft">
                  <span className="text-ink">{i.taskNameZh}</span>
                  {i.attemptId ? (
                    <Link href={`/pte/attempts/${i.attemptId}`} className="text-primary-ink hover:underline">
                      {i.score !== null ? `${i.score}/${i.maxScore}` : i.form ? `${i.form.words} 词 · 看 AI 反馈` : i.hasFeedback ? "看 AI 反馈" : "查看"}
                    </Link>
                  ) : (
                    <span className="text-muted">没有作答</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
