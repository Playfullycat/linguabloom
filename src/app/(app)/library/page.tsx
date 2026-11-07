import { BookOpen, Headphones, Library, ListPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DeleteImported } from "@/components/library/import-review";
import { ImportForm } from "@/components/library/import-form";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { COPYRIGHT_LABELS, COPYRIGHT_STATUSES, listImports } from "@/modules/imports/services/imports";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Library" };

const PURPOSE = {
  reading: { icon: BookOpen, label: "阅读" },
  listening: { icon: Headphones, label: "听力" },
  vocabulary: { icon: ListPlus, label: "词表" },
} as const;

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Library className="size-4" aria-hidden="true" />
            <span lang="en">Library</span> · 我的材料
          </span>
        }
        title="Library"
        titleZh="我的材料"
        description="导入你自己的文章、字幕、音频和词表。先解析成草稿，你看过预览、确认后才进入学习库。导入的材料只给你自己用。"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>导入新材料</CardTitle>
            <CardDescription>支持粘贴文本、TXT、Markdown、SRT / VTT 字幕、CSV / TSV 词表和常见音频。</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportForm copyrightOptions={COPYRIGHT_STATUSES.map((value) => ({ value, label: COPYRIGHT_LABELS[value] }))} />
          </CardContent>
        </Card>
        <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
          <ImportList />
        </Suspense>
      </div>
    </>
  );
}

async function ImportList() {
  const user = await requireOwner();
  const db = getDb();
  const [items, { profile }] = await Promise.all([listImports(db, user.id), getLearnerSettings(db, user.id)]);
  const drafts = items.filter((i) => i.status === "draft");
  const published = items.filter((i) => i.status === "published");
  const row = (i: (typeof items)[number]) => {
    const P = PURPOSE[i.purpose as keyof typeof PURPOSE] ?? PURPOSE.reading;
    const href = i.status === "draft" ? `/library/${i.id}` : i.contentId ? `/${i.purpose === "listening" ? "listening" : "reading"}/${i.contentId}` : "/vocabulary";
    return (
      <li key={i.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-soft text-blue-ink">
            <P.icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <Link href={href} className="font-medium text-ink hover:underline">
              {i.title}
            </Link>
            <p className="text-xs text-muted">
              {P.label} · {i.purpose === "vocabulary" ? `${i.count} 个词` : `${i.count} 句`} · {COPYRIGHT_LABELS[i.copyrightStatus as keyof typeof COPYRIGHT_LABELS] ?? i.copyrightStatus} ·{" "}
              {(i.publishedAt ?? i.createdAt).toLocaleDateString("zh-CN", { timeZone: profile.timezone })}
            </p>
          </div>
          {i.status === "draft" ? <Badge tone="yellow">待确认</Badge> : <Badge tone="mint">已导入</Badge>}
        </div>
        {i.status === "published" && i.contentId ? (
          <div className="flex justify-end">
            <DeleteImported importId={i.id} title={i.title} />
          </div>
        ) : null}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>草稿</CardTitle>
          <CardDescription>还没确认的导入，打开看预览。</CardDescription>
        </CardHeader>
        <CardContent>{drafts.length === 0 ? <p className="text-sm text-muted">没有草稿。</p> : <ul className="flex flex-col gap-2">{drafts.map(row)}</ul>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已导入</CardTitle>
          <CardDescription>文章和字幕在“阅读”“听力”里也能找到；词表里的词已经进入词汇库和复习。</CardDescription>
        </CardHeader>
        <CardContent>{published.length === 0 ? <p className="text-sm text-muted">还没有导入过材料。</p> : <ul className="flex flex-col gap-2">{published.map(row)}</ul>}</CardContent>
      </Card>
    </div>
  );
}
