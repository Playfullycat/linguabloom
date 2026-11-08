import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MicroLessonActions } from "@/components/ai/generation-controls";
import { ErrorNote, ErrorPractice } from "@/components/errors/error-actions";
import { ExerciseRunner } from "@/components/grammar/exercise-runner";
import { SOURCE_LABELS, errorStatus } from "@/components/errors/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { aiStatus } from "@/modules/ai/provider";
import { latestMicroLesson, type MicroLesson } from "@/modules/ai/services/generation";
import { ErrorItemNotFoundError, getErrorItem } from "@/modules/errors/services/errors";
import { clientExercises } from "@/modules/grammar/services/grammar";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Error Notebook" };

export default function ErrorItemPage({ params }: PageProps<"/errors/[itemId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/errors/[itemId]">, "params">) {
  const { itemId } = await params;
  const user = await requireOwner();
  const db = getDb();
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) notFound();
  const data = await getErrorItem(db, user.id, itemId).catch((e: unknown) => {
    if (e instanceof ErrorItemNotFoundError) return null;
    throw e;
  });
  if (!data) notFound();
  const { profile } = await getLearnerSettings(db, user.id);
  const tz = profile.timezone;
  const { item, occurrences, grammarPoint } = data;
  const aiAvailable = aiStatus().available;
  const microRow = aiAvailable ? await latestMicroLesson(db, user.id, item.id) : null;
  const micro = microRow
    ? {
        id: microRow.id,
        status: microRow.status,
        warnings: microRow.warnings,
        lesson: microRow.payload as MicroLesson,
        exercises: microRow.status === "published" && microRow.resultRef ? await clientExercises(db, microRow.resultRef.split(",")) : [],
      }
    : null;
  const s = errorStatus(item);
  const category = ERROR_CATEGORY_LABELS[item.category as keyof typeof ERROR_CATEGORY_LABELS] ?? item.category;
  const fmt = (d: Date) => d.toLocaleString("zh-CN", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/errors" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Error Notebook</span> · 错误本
          </Link>
        }
        title={item.title}
        titleZh={category}
        description={`出现 ${item.occurrenceCount} 次 · 首次 ${item.firstSeenAt.toLocaleDateString("zh-CN", { timeZone: tz })} · 最近 ${item.lastSeenAt.toLocaleDateString("zh-CN", { timeZone: tz })}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={s.tone}>{s.label}</Badge>
        {item.recurredCount > 0 ? <Badge tone="coral">解决后又出现过 {item.recurredCount} 次</Badge> : null}
        {grammarPoint ? (
          <Link href={`/grammar/${grammarPoint.id}`} className="text-sm text-primary-ink underline-offset-4 hover:underline">
            看讲解：{grammarPoint.titleZh}
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{item.canPractise ? "补救与再测" : "怎么改进"}</CardTitle>
            </CardHeader>
            <CardContent>
              {item.canPractise ? (
                <p className="mb-4 text-sm text-muted">
                  补救：针对这个知识点做 3 道题，答对 2 道就算通过。再测：隔天换 2 道没做过的题（尽量换题型），全部答对才标记为已解决。
                </p>
              ) : (
                <p className="mb-4 text-sm text-muted">这类错误暂时没有专门的题库。回到出错的地方再练一遍；觉得已经掌握了，可以手动标记，以后再错会自动重新打开。</p>
              )}
              <ErrorPractice
                itemId={item.id}
                status={item.status}
                canPractise={item.canPractise}
                needsRemediation={item.needsRemediation}
                retestDue={item.retestDue}
                retestDueLabel={item.retestDueAt ? fmt(item.retestDueAt) : null}
                practiceHref={item.practiceHref}
              />
            </CardContent>
          </Card>

          {aiAvailable ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  AI 微课 <Badge tone="yellow">AI 生成</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {micro ? (
                  <>
                    <p className="font-medium text-ink">{micro.lesson.title_zh}</p>
                    <p className="text-sm text-ink">{micro.lesson.explanation_zh}</p>
                    <ul className="text-sm">
                      {micro.lesson.examples.map((e) => (
                        <li key={e.en}>
                          <span lang="en" className="text-ink">
                            {e.en}
                          </span>
                          <span className="ml-2 text-muted">{e.zh}</span>
                        </li>
                      ))}
                    </ul>
                    {micro.warnings.length > 0 ? <p className="text-xs text-yellow-ink">{micro.warnings.join(" ")}</p> : null}
                  </>
                ) : (
                  <p className="text-sm text-muted">让 AI 针对这个错误写一段很短的讲解，再出 3 道新语境的练习题。生成后先给你看，确认了才开始练。</p>
                )}
                {micro?.status === "published" ? (
                  <ExerciseRunner exercises={micro.exercises} context="practice" />
                ) : (
                  <MicroLessonActions errorItemId={item.id} draftId={micro?.status === "draft" ? micro.id : null} />
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>出错记录</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {occurrences.map((o) => (
                  <li key={o.id} className="flex flex-col gap-0.5 border-l-2 border-coral/40 pl-3 text-sm">
                    <span className="text-muted">
                      {fmt(o.createdAt)} · {SOURCE_LABELS[o.source] ?? o.source}
                    </span>
                    {o.wrong ? (
                      <span lang="en">
                        <span className="sr-only">写的：</span>
                        <span className="text-coral-ink line-through decoration-coral/60">{o.wrong}</span>
                        {o.correct ? (
                          <>
                            <span className="text-muted"> → </span>
                            <span className="sr-only">正确：</span>
                            <span className="text-mint-ink">{o.correct}</span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-6">
              <ErrorNote itemId={item.id} initial={item.note ?? ""} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
