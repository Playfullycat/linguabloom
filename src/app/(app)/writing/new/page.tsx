import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { WritingEditor } from "@/components/writing/writing-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { requireOwner } from "@/lib/auth/session";
import { CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { WRITING_TYPE_LABELS, loadWritingPrompts } from "@/modules/writing/content";

export const metadata: Metadata = { title: "Writing" };

export default function NewWritingPage({ searchParams }: PageProps<"/writing/new">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}

async function Loader({ searchParams }: Pick<PageProps<"/writing/new">, "searchParams">) {
  await requireOwner();
  const { prompt: promptId } = await searchParams;
  const prompt = typeof promptId === "string" ? loadWritingPrompts().find((p) => p.id === promptId) : undefined;
  if (typeof promptId === "string" && !prompt) notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/writing" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Writing</span> · 写作
          </Link>
        }
        title={prompt ? prompt.title_zh : "自由写作"}
        titleZh={prompt?.title_en}
        description={prompt ? undefined : "自己定题目和要求，AI 会按你的要求给反馈。"}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card>
          <CardContent className="pt-6">
            <WritingEditor promptId={prompt?.id ?? null} minWords={prompt?.min_words ?? 20} maxWords={prompt?.max_words ?? 300} custom={!prompt} />
          </CardContent>
        </Card>
        {prompt ? (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 text-sm">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="primary">{CEFR_LEVEL_LABELS[prompt.level]}</Badge>
                <Badge>{WRITING_TYPE_LABELS[prompt.type]}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-ink">{prompt.task_zh}</p>
              <p lang="en" className="text-muted">
                {prompt.task_en}
              </p>
              {prompt.source_material ? (
                <Link href={`/reading/${prompt.source_material}`} className="text-primary-ink underline-offset-4 hover:underline">
                  先去读原文
                </Link>
              ) : null}
              <div>
                <p className="font-medium text-ink">写完对照一下</p>
                <ul className="mt-1 text-muted">
                  {prompt.checklist_zh.map((c) => (
                    <li key={c}>· {c}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
