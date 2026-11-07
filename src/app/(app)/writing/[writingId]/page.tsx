import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { FeedbackView } from "@/components/writing/feedback-view";
import { DeleteWriting, RetryFeedback, RevisionForm } from "@/components/writing/writing-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { grammarPoints } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { diffWords } from "@/modules/writing/domain/diff";
import { WritingNotFoundError, getWriting } from "@/modules/writing/services/writing";

export const metadata: Metadata = { title: "Writing" };

export default function WritingResultPage({ params }: PageProps<"/writing/[writingId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/writing/[writingId]">, "params">) {
  const { writingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(writingId)) notFound();
  const user = await requireOwner();
  const db = getDb();
  const w = await getWriting(db, user.id, writingId).catch((e: unknown) => {
    if (e instanceof WritingNotFoundError) return null;
    throw e;
  });
  if (!w) notFound();
  const titles = Object.fromEntries((await db.select({ id: grammarPoints.id, title: grammarPoints.titleZh }).from(grammarPoints)).map((g) => [g.id, g.title]));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/writing" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Writing</span> · 写作
          </Link>
        }
        title={w.task.title}
        titleZh={w.task.level}
        description={w.task.task}
        actions={<DeleteWriting id={w.id} />}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>第一版</CardTitle>
            </CardHeader>
            <CardContent>
              <p lang="en" className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
                {w.originalText}
              </p>
            </CardContent>
          </Card>
          {w.revisedText ? (
            <Card>
              <CardHeader>
                <CardTitle>第二版（和第一版对比）</CardTitle>
              </CardHeader>
              <CardContent>
                <p lang="en" className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink" aria-label="改动对比">
                  {diffWords(w.originalText, w.revisedText).map((part, i) =>
                    part.type === "same" ? (
                      <span key={i}>{part.text}</span>
                    ) : part.type === "added" ? (
                      <ins key={i} className="rounded bg-mint-soft text-mint-ink no-underline">
                        <span className="sr-only">（新增）</span>
                        {part.text}
                      </ins>
                    ) : (
                      <del key={i} className="rounded bg-coral-soft text-coral-ink">
                        <span className="sr-only">（删掉）</span>
                        {part.text}
                      </del>
                    ),
                  )}
                </p>
              </CardContent>
            </Card>
          ) : null}
          {w.status === "feedback" && w.feedback ? (
            <Card>
              <CardContent className="pt-6">
                <RevisionForm id={w.id} original={w.originalText} minWords={w.task.minWords} maxWords={w.task.maxWords} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {w.status === "draft" ? (
            <Card>
              <CardContent className="flex flex-col gap-3 pt-6 text-sm">
                <p className="text-ink">这篇还没有反馈（上次请求失败，或者 AI 还没配置）。文章已经保存好了。</p>
                <RetryFeedback id={w.id} />
              </CardContent>
            </Card>
          ) : null}
          {w.revisionFeedback ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  第二版的反馈 <Badge tone="mint">对比</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {w.revisionFeedback.comparison ? (
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-mint-soft p-3 text-mint-ink">
                      <p className="font-medium">改进了</p>
                      <ul>{w.revisionFeedback.comparison.improved.length ? w.revisionFeedback.comparison.improved.map((x) => <li key={x}>· {x}</li>) : <li>—</li>}</ul>
                    </div>
                    <div className="rounded-xl bg-yellow-soft p-3 text-yellow-ink">
                      <p className="font-medium">还可以再改</p>
                      <ul>{w.revisionFeedback.comparison.still_to_fix.length ? w.revisionFeedback.comparison.still_to_fix.map((x) => <li key={x}>· {x}</li>) : <li>—</li>}</ul>
                    </div>
                  </div>
                ) : null}
                <FeedbackView feedback={w.revisionFeedback} grammarTitles={titles} />
              </CardContent>
            </Card>
          ) : null}
          {w.feedback ? (
            <Card>
              <CardHeader>
                <CardTitle>{w.revisionFeedback ? "第一版的反馈" : "反馈"}</CardTitle>
              </CardHeader>
              <CardContent>
                <FeedbackView feedback={w.feedback} grammarTitles={titles} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
