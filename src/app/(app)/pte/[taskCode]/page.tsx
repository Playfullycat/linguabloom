import { ArrowLeft, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { SECTION_LABELS, TASK_CODES, type Section } from "@/modules/pte/content";
import { PteNotFoundError, getCurrentVersion, getTaskType, listAttempts, listPrompts } from "@/modules/pte/services/pte";

export const metadata: Metadata = { title: "PTE task type" };

const TIMING_LABELS: Record<string, (v: unknown) => string> = {
  prep_seconds: (v) => `准备 ${Array.isArray(v) ? v.join("–") : v} 秒`,
  response_seconds: (v) => `作答 ${v} 秒`,
  response_minutes: (v) => `作答 ${v} 分钟`,
  audio_seconds: (v) => `录音 ${Array.isArray(v) ? v.join("–") : v} 秒`,
  audio_seconds_max: (v) => `录音最长 ${v} 秒`,
  text_words_max: (v) => `文字最多 ${v} 词`,
  answer_words: (v) => `答案 ${Array.isArray(v) ? v.join("–") : v} 词`,
  zero_outside_words: (v) => `少于 ${(v as number[])[0]} 或多于 ${(v as number[])[1]} 词为 0 分`,
  recordings: (v) => `录音 ${v} 次`,
  start_within_seconds: (v) => `约 ${v} 秒内开口`,
  speakers: (v) => `${v} 位说话人`,
  situation_words_max: (v) => `情景最多 ${v} 词`,
  options: (v) => `${Array.isArray(v) ? v.join("–") : v} 个选项`,
  sentences: (v) => `${v} 句话`,
  replay: (v) => (v ? "可以重放" : "不能重放"),
  per_item: () => "官方没有单题时限（按部分计时）",
};

export default function PteTaskPage({ params }: PageProps<"/pte/[taskCode]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <TaskLoader params={params} />
    </Suspense>
  );
}

async function TaskLoader({ params }: Pick<PageProps<"/pte/[taskCode]">, "params">) {
  const { taskCode } = await params;
  if (!(TASK_CODES as readonly string[]).includes(taskCode)) notFound();
  const user = await requireOwner();
  const db = getDb();
  const version = await getCurrentVersion(db);
  const type = await getTaskType(db, version.id, taskCode).catch((e: unknown) => {
    if (e instanceof PteNotFoundError) return null;
    throw e;
  });
  if (!type) notFound();
  const [prompts, attempts, { profile }] = await Promise.all([listPrompts(db, user.id, taskCode), listAttempts(db, user.id, taskCode, 10), getLearnerSettings(db, user.id)]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/pte" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            PTE 专区 · {SECTION_LABELS[type.section as Section]}
          </Link>
        }
        title={type.nameEn}
        titleZh={type.nameZh}
        description={type.descriptionZh}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>官方说明</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm" data-testid="pte-official">
            <p className="text-xs text-muted">
              来源：Pearson 官方题型页（{version.reviewedOn} 核对）。以下是转述，以官方页面为准。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(type.timing)
                .filter(([k]) => k !== "suggested_seconds" && TIMING_LABELS[k])
                .map(([k, v]) => (
                  <Badge key={k} tone="outline">
                    {TIMING_LABELS[k]!(v)}
                  </Badge>
                ))}
            </div>
            <div>
              <p className="font-medium text-ink">官方评分</p>
              <p className="text-muted">{type.scoring.official_zh}</p>
            </div>
            <div>
              <p className="font-medium text-ink">本应用怎么判分</p>
              <p className="text-muted">
                {type.scoring.method === "ai_traits" ? "客观部分（例如词数）由程序检查，其余是 AI 辅助反馈，不给分数。" : type.scoring.rule_zh ?? type.scoring.official_zh}
              </p>
              {type.scoring.unconfirmed ? <p className="mt-1 text-xs text-yellow-ink">这条计分规则是本应用的做法，官方没有公开具体公式。</p> : null}
            </div>
            <div>
              <p className="font-medium text-ink">影响的技能</p>
              <p className="text-muted">{type.skills.map((s) => ({ listening: "听力", reading: "阅读", speaking: "口语", writing: "写作" })[s] ?? s).join("、")}</p>
            </div>
            {type.tipsZh.length > 0 ? (
              <div>
                <p className="font-medium text-ink">练习建议</p>
                <ul className="list-disc pl-5 text-muted">
                  {type.tipsZh.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="flex items-start gap-2 rounded-xl bg-blue-soft p-3 text-blue-ink">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              这里的得分只说明你在这道原创练习题上的表现，不能换算成 PTE 分数。
            </p>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>练习题</CardTitle>
            </CardHeader>
            <CardContent>
              {!type.practiceAvailable ? (
                <p className="text-sm text-muted">这个题型的练习在下一步（4.3）上线。现在可以先看左边的官方说明。</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="pte-prompts">
                  {prompts.map((p) => (
                    <li key={p.id}>
                      <Link href={`/pte/${taskCode}/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="font-medium text-ink">{p.titleZh}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Badge size="sm">难度 {p.difficulty}</Badge>
                          {p.attempts > 0 ? (
                            <Badge size="sm" tone={p.best !== null && p.best >= 1 ? "mint" : "blue"}>
                              {p.best !== null ? `最好 ${Math.round(p.best * 100)}%` : `做过 ${p.attempts} 次`}
                            </Badge>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {attempts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>最近的练习</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="pte-history">
                  {attempts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/pte/attempts/${a.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-soft">
                        <span className="text-ink">{(a.snapshot as { promptTitleZh: string }).promptTitleZh}</span>
                        <span className="text-muted">
                          {a.score !== null ? `${a.score}/${a.maxScore}` : "AI 反馈"} · {a.mode === "timed" ? "计时" : "练习"}
                          {a.timedOut ? "（超时提交）" : ""} · {a.createdAt.toLocaleDateString("zh-CN", { timeZone: profile.timezone, month: "numeric", day: "numeric" })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
