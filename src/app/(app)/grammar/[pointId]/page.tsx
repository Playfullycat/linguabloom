import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExerciseRunner } from "@/components/grammar/exercise-runner";
import { MASTERY_TONES } from "@/components/grammar/mastery";
import { PageHeader } from "@/components/layout/page-header";
import { SpeakButton } from "@/components/media/speak-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { BREAKDOWN_ROLE_LABELS, ERROR_CATEGORY_LABELS, type BreakdownRole } from "@/modules/grammar/content";
import { GrammarNotFoundError, MASTERY_LABELS, getGrammarPoint } from "@/modules/grammar/services/grammar";


export const metadata: Metadata = { title: "Grammar" };

const ROLE_STYLES: Record<BreakdownRole, string> = {
  subject: "bg-blue-soft text-blue-ink",
  verb: "bg-coral-soft text-coral-ink",
  object: "bg-mint-soft text-mint-ink",
  complement: "bg-yellow-soft text-yellow-ink",
  time: "bg-primary-soft text-primary-ink",
  place: "bg-primary-soft text-primary-ink",
  adverb: "bg-surface-soft text-ink",
  question: "bg-blue-soft text-blue-ink",
  other: "bg-surface-soft text-muted",
};

export default function GrammarPointPage({ params }: PageProps<"/grammar/[pointId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载语法点…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/grammar/[pointId]">, "params">) {
  const { pointId } = await params;
  const user = await requireOwner();
  const data = await getGrammarPoint(getDb(), user.id, pointId).catch((e: unknown) => {
    if (e instanceof GrammarNotFoundError) return null;
    throw e;
  });
  if (!data) notFound();
  const { point, content: c } = data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/grammar" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Grammar</span> · 语法地图
          </Link>
        }
        title={point.titleZh}
        titleZh={point.titleEn}
        description={c.summary_zh}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="primary">{point.levelLabel}</Badge>
        <Badge tone={MASTERY_TONES[point.mastery]}>{MASTERY_LABELS[point.mastery]}</Badge>
        {point.accuracy !== null ? <Badge>最近 {point.attempts} 题，正确率 {Math.round(point.accuracy * 100)}%</Badge> : null}
        {data.reviewStatus !== "reviewed" ? <Badge tone="outline">讲解待 owner 复核</Badge> : null}
      </div>

      {point.status === "planned" ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6 text-sm text-muted">
            <p>这个语法点还在规划中，讲解和练习会在后续内容更新里加入。</p>
            {point.prerequisites.length > 0 ? <p>学它之前，先掌握：{point.prerequisites.map((p) => p.titleZh).join("、")}。</p> : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>规则</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-[0.9375rem] leading-relaxed text-ink">{c.explanation_zh}</p>
                <div className="rounded-xl bg-surface-soft p-4">
                  <p className="mb-2 text-sm font-medium text-muted">结构</p>
                  <ul className="flex flex-col gap-1">
                    {c.structure.map((s) => (
                      <li key={s} className="font-mono text-[0.9375rem] text-ink">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-muted">什么时候用</p>
                  <ul className="flex flex-col gap-1 text-[0.9375rem] text-ink">
                    {c.usage_zh.map((u) => (
                      <li key={u}>· {u}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>例句</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {c.examples.map((e) => (
                    <li key={e.en} className="flex items-start gap-2">
                      <SpeakButton text={e.en} />
                      <div>
                        <p lang="en" className="text-[0.9375rem] text-ink">
                          {e.en}
                        </p>
                        <p className="text-sm text-muted">{e.zh}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>句子拆解</CardTitle>
                <CardDescription>不同颜色代表句子里的不同成分。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {c.breakdowns.map((b) => (
                  <figure key={b.zh} className="flex flex-col gap-2">
                    <div lang="en" className="flex flex-wrap gap-1.5">
                      {b.parts.map((part, i) => (
                        <span key={i} className={cn("flex flex-col items-center rounded-lg px-2.5 py-1.5", ROLE_STYLES[part.role])}>
                          <span className="text-[0.9375rem] font-medium">{part.text}</span>
                          <span lang="zh-CN" className="text-[0.6875rem] opacity-80">
                            {BREAKDOWN_ROLE_LABELS[part.role]}
                          </span>
                        </span>
                      ))}
                    </div>
                    <figcaption className="text-sm text-muted">{b.zh}</figcaption>
                  </figure>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>常见错误</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {c.common_errors.map((e) => (
                    <li key={e.wrong} className="flex flex-col gap-0.5 text-[0.9375rem]">
                      <span lang="en" className="text-coral-ink line-through decoration-coral/60">
                        <span className="sr-only">错误：</span>
                        {e.wrong}
                      </span>
                      <span lang="en" className="text-mint-ink">
                        <span className="sr-only">正确：</span>✓ {e.right}
                      </span>
                      <span className="text-sm text-muted">{e.why_zh}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {c.contrast || c.limits_zh.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{c.contrast?.title_zh ?? "限制与例外"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {c.contrast ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {c.contrast.items.map((i) => (
                        <div key={i.en} className="rounded-xl bg-surface-soft p-3">
                          <p lang="en" className="text-[0.9375rem] font-medium text-ink">
                            {i.en}
                          </p>
                          <p className="text-sm text-muted">{i.zh}</p>
                          <p className="mt-1 text-sm text-primary-ink">{i.note_zh}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {c.limits_zh.length > 0 ? (
                    <div>
                      {c.contrast ? <p className="mb-1 text-sm font-medium text-muted">限制与例外</p> : null}
                      <ul className="flex flex-col gap-1 text-sm text-ink">
                        {c.limits_zh.map((l) => (
                          <li key={l}>· {l}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card id="practice">
              <CardHeader>
                <CardTitle>练习</CardTitle>
                <CardDescription>选择、填空、排序、改错和造句。做错的题会记入错误本（错误类别：{ERROR_CATEGORY_LABELS[data.defaultErrorCategory as keyof typeof ERROR_CATEGORY_LABELS] ?? data.defaultErrorCategory}）。</CardDescription>
              </CardHeader>
              <CardContent>
                <ExerciseRunner exercises={data.exercises} context="practice" initialResults={data.lastAttempts} />
              </CardContent>
            </Card>
          </div>

          <aside className="flex flex-col gap-4" aria-label="相关信息">
            {point.prerequisites.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>先学这些</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2">
                    {point.prerequisites.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <Link href={`/grammar/${p.id}`} className="text-sm text-primary-ink hover:underline">
                          {p.titleZh}
                        </Link>
                        <Badge size="sm" tone={MASTERY_TONES[p.mastery]}>
                          {MASTERY_LABELS[p.mastery]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <BookOpen className="size-4 text-primary-ink" aria-hidden="true" />
                <CardTitle>在这些课学过</CardTitle>
              </CardHeader>
              <CardContent>
                {data.taughtIn.length === 0 ? (
                  <p className="text-sm text-muted">现有课程里还没有专门讲这个语法点的单元。</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {data.taughtIn.map((u) => (
                      <li key={u.id}>
                        <Link href={`/learn/units/${u.id}`} className="text-sm text-primary-ink hover:underline">
                          {u.levelLabel} · Unit {u.order} <span lang="en">{u.titleEn}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <AlertTriangle className="size-4 text-coral-ink" aria-hidden="true" />
                <CardTitle>最近在哪用错</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentErrors.length === 0 ? (
                  <p className="text-sm text-muted">还没有相关错误记录。</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.recentErrors.map((e) => (
                      <li key={e.id} className="flex flex-col gap-1 text-sm">
                        <Link href={`/errors/${e.id}`} className="font-medium text-primary-ink hover:underline">
                          {ERROR_CATEGORY_LABELS[e.category as keyof typeof ERROR_CATEGORY_LABELS] ?? e.category} · 出现 {e.occurrenceCount} 次
                          {e.status === "resolved" ? "（已解决）" : ""}
                        </Link>
                        {e.recent.map((o) => (
                          <span key={o.id} lang="en" className="text-muted">
                            <span className="text-coral-ink line-through">{o.wrong}</span> → {o.correct}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            {data.next ? (
              <Button asChild variant="soft">
                <Link href={`/grammar/${data.next.id}`}>
                  下一个：{data.next.titleZh.split("：")[0]}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
