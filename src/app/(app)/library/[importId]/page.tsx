import { ArrowLeft, Music, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ImportConfirm } from "@/components/library/import-review";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { COPYRIGHT_LABELS, ImportNotFoundError, getImport } from "@/modules/imports/services/imports";

export const metadata: Metadata = { title: "Library" };

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;

export default function ImportPreviewPage({ params }: PageProps<"/library/[importId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载预览…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/library/[importId]">, "params">) {
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const user = await requireOwner();
  const imp = await getImport(getDb(), user.id, importId).catch((e: unknown) => {
    if (e instanceof ImportNotFoundError) return null;
    throw e;
  });
  if (!imp || imp.status === "discarded") notFound();
  const p = imp.parsed;
  const nothing = p.items.length === 0 || (p.kind === "words" && p.items.every((w) => w.status === "already"));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/library" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Library</span> · 我的材料
          </Link>
        }
        title={imp.title}
        titleZh={imp.status === "draft" ? "预览" : "已导入"}
        description={`${imp.fileName ? `文件：${imp.fileName}` : "粘贴的内容"} · ${COPYRIGHT_LABELS[imp.copyrightStatus as keyof typeof COPYRIGHT_LABELS] ?? imp.copyrightStatus}${imp.sourceNote ? ` · ${imp.sourceNote}` : ""}`}
      />
      <div className="flex flex-col gap-4">
        {p.warnings.length > 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-1.5 pt-6">
              {p.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-sm text-yellow-ink">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {w}
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {imp.status === "draft" ? (
          <Card>
            <CardHeader>
              <CardTitle>确认导入</CardTitle>
            </CardHeader>
            <CardContent>
              <ImportConfirm
                importId={imp.id}
                title={imp.title}
                suggestedLevel={imp.suggestedLevel}
                isWords={p.kind === "words"}
                disabled={nothing}
                levels={CEFR_LEVELS.map((value) => ({ value, label: CEFR_LEVEL_LABELS[value] }))}
              />
              {nothing ? <p className="mt-3 text-sm text-muted">没有可以导入的新内容。</p> : null}
            </CardContent>
          </Card>
        ) : null}

        {p.kind === "segments" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>难度分析</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {[
                    ["词数", p.analysis.wordCount],
                    ["句数", p.analysis.sentenceCount],
                    ["平均句长", `${p.analysis.averageSentenceLength} 词`],
                    ["最长句", `${p.analysis.longestSentence} 词`],
                    ["不同的词", p.analysis.uniqueWords],
                    ["超过 20 词的长句", p.analysis.longSentences],
                    ["词汇库里已有的词", p.analysis.knownShare === null ? "—" : `${Math.round(p.analysis.knownShare * 100)}%`],
                    ["建议等级", isCefrLevel(p.analysis.suggestedLevel) ? CEFR_LEVEL_LABELS[p.analysis.suggestedLevel] : p.analysis.suggestedLevel],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-surface-soft px-3 py-2">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-medium text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted">这些数字直接从文本算出，不用 AI。建议等级只看平均句长，很粗略；AI 分析词汇和语法难度在 Phase 3。</p>
                {imp.audio ? (
                  <p className="flex items-center gap-2 text-sm text-ink">
                    <Music className="size-4 text-primary-ink" aria-hidden="true" />
                    音频：{imp.audio.name}（{(imp.audio.sizeBytes / 1024 / 1024).toFixed(1)} MB）{p.timed ? "，可以逐句对齐" : ""}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>分句预览（{p.items.length} 句）</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-1.5" aria-label="分句预览">
                  {p.items.map((s, i) => (
                    <li key={i} className="flex gap-3 text-[0.9375rem]">
                      <span className="w-20 shrink-0 text-right font-mono text-xs leading-6 text-muted">{s.startMs !== null ? fmt(s.startMs) : `¶${s.paragraph + 1}`}</span>
                      <span lang="en" className="text-ink">
                        {s.speaker ? <span className="mr-1 text-sm font-medium text-muted">{s.speaker}:</span> : null}
                        {s.en}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>词表预览（{p.items.length} 个词）</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">单词</th>
                    <th className="py-1.5 pr-3 font-medium">释义</th>
                    <th className="py-1.5 pr-3 font-medium">例句</th>
                    <th className="py-1.5 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((w) => (
                    <tr key={w.line} className="border-t border-border">
                      <td lang="en" className="py-1.5 pr-3 font-medium text-ink">
                        {w.text}
                        {w.ipa ? <span className="ml-1 text-xs text-muted">{w.ipa}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 text-ink">{w.zh}</td>
                      <td lang="en" className="py-1.5 pr-3 text-muted">
                        {w.exampleEn ?? "—"}
                      </td>
                      <td className="py-1.5">{w.status === "already" ? <Badge size="sm">词汇库已有，跳过</Badge> : <Badge size="sm" tone="mint">新词</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
