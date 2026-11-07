import { ArrowLeft, Sparkles, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GenerationReview } from "@/components/ai/generation-controls";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { GenerationNotFoundError, getGeneration } from "@/modules/ai/services/generation";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import type { Material } from "@/modules/materials/content";
import type { GlossaryEntry } from "@/modules/materials/domain/text";

export const metadata: Metadata = { title: "AI draft" };

export default function GenerationPage({ params }: PageProps<"/library/ai/[genId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载草稿…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

function GlossaryList({ glossary }: { glossary: GlossaryEntry[] }) {
  return glossary.length === 0 ? (
    <p className="text-sm text-muted">没有生词表。</p>
  ) : (
    <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
      {glossary.map((g) => (
        <li key={g.key}>
          <span lang="en" className="font-medium text-ink">
            {g.text}
          </span>
          {g.ipa ? <span className="ml-1 text-xs text-muted">{g.ipa}</span> : null}
          <span className="ml-2 text-muted">{g.zh}</span>
        </li>
      ))}
    </ul>
  );
}

function QuestionList({ questions }: { questions: Material["questions"] }) {
  return questions.length === 0 ? (
    <p className="text-sm text-muted">没有理解题。</p>
  ) : (
    <ol className="flex flex-col gap-3 text-sm">
      {questions.map((q, i) => (
        <li key={q.id}>
          <p className="font-medium text-ink">
            {i + 1}. {q.prompt_zh}
            {q.segment !== undefined ? <span className="ml-2 text-xs text-muted">（依据第 {q.segment + 1} 句）</span> : null}
          </p>
          <ul className="mt-1">
            {q.options.map((o, k) => (
              <li key={k} className={k === q.answer ? "text-mint-ink" : "text-muted"}>
                {k === q.answer ? "✓ " : "· "}
                {o}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{q.explanation_zh}</p>
        </li>
      ))}
    </ol>
  );
}

async function Loader({ params }: Pick<PageProps<"/library/ai/[genId]">, "params">) {
  const { genId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(genId)) notFound();
  const user = await requireOwner();
  const g = await getGeneration(getDb(), user.id, genId).catch((e: unknown) => {
    if (e instanceof GenerationNotFoundError) return null;
    throw e;
  });
  if (!g || g.kind === "micro_lesson") notFound();
  const graded = g.kind === "graded_reading" ? (g.payload as Material) : null;
  const enrichment = g.kind === "material_enrichment" ? (g.payload as { glossary: GlossaryEntry[]; questions: Material["questions"] }) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/library" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Library</span> · 我的材料
          </Link>
        }
        title={graded ? graded.title_en : "AI 生成的生词表和理解题"}
        titleZh={graded ? graded.title_zh : "草稿"}
        description={graded ? graded.summary_zh : "看过之后再决定要不要加到材料上。"}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone="yellow">
                <Sparkles aria-hidden="true" />
                AI 生成{g.provider === "mock" ? "（模拟）" : ""}
              </Badge>
              <Badge>{g.status === "draft" ? "草稿" : g.status === "published" ? "已加入" : "已丢弃"}</Badge>
              {graded ? <Badge tone="primary">{isCefrLevel(graded.level) ? CEFR_LEVEL_LABELS[graded.level] : graded.level}</Badge> : null}
            </p>
            <p className="text-muted">已经自动检查过：结构、句长不超过 30 词、生词确实出现在原文里、每道题只有一个正确答案。自然度和内容是否合适，请你自己看一眼。</p>
            {g.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-yellow-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {w}
              </p>
            ))}
            {g.status === "draft" ? <GenerationReview id={g.id} kind={g.kind} /> : null}
            {g.status === "published" && g.resultRef ? (
              <Link href={`/${graded?.type ?? (g.resultRef.startsWith("ai-ls") ? "listening" : "reading")}/${g.resultRef}`} className="text-primary-ink underline-offset-4 hover:underline">
                打开这份材料
              </Link>
            ) : null}
          </CardContent>
        </Card>
        {graded ? (
          <Card>
            <CardHeader>
              <CardTitle>正文（{graded.segments.length} 句）</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2">
                {graded.segments.map((s, i) => (
                  <li key={i} className="text-[0.9375rem]">
                    <p lang="en" className="text-ink">
                      {s.speaker ? <span className="mr-1 text-sm font-medium text-muted">{s.speaker}:</span> : null}
                      {s.en}
                    </p>
                    <p className="text-sm text-muted">{s.zh}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>生词表</CardTitle>
          </CardHeader>
          <CardContent>
            <GlossaryList glossary={(graded ?? enrichment)!.glossary} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>理解题</CardTitle>
          </CardHeader>
          <CardContent>
            <QuestionList questions={(graded ?? enrichment)!.questions} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
