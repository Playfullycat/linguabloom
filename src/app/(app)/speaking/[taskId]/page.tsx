import { ArrowLeft, Mic } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SpeakingLab } from "@/components/speaking/speaking-lab";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_STATUS_LABELS, aiStatus } from "@/modules/ai/provider";
import { CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { SPEAKING_TYPE_LABELS, getSpeakingTask, isScripted } from "@/modules/speaking/content";
import { latestAttemptFor, speakingSource } from "@/modules/speaking/services/speaking";

export const metadata: Metadata = { title: "Speaking" };

export default function SpeakingTaskPage({ params }: PageProps<"/speaking/[taskId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在准备…" />}>
      <TaskLoader params={params} />
    </Suspense>
  );
}

async function TaskLoader({ params }: Pick<PageProps<"/speaking/[taskId]">, "params">) {
  const { taskId } = await params;
  const task = getSpeakingTask(taskId);
  if (!task) notFound();
  const user = await requireOwner();
  const db = getDb();
  const status = aiStatus();
  const [{ preferences }, source, latest] = await Promise.all([getLearnerSettings(db, user.id), speakingSource(db, task), latestAttemptFor(db, user.id, task.id)]);
  const scripted = isScripted(task.type);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/speaking" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            口语 · {SPEAKING_TYPE_LABELS[task.type]}
          </Link>
        }
        title={task.title_en}
        titleZh={task.title_zh}
        description={task.goal_zh}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="size-5" aria-hidden="true" />
              练习
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SpeakingLab
              // A finished session never comes back when this page is shown again.
              key={latest?.id ?? "none"}
              task={{ id: task.id, type: task.type, scripted, opening: task.opening_en ?? null, items: task.items ?? [] }}
              defaults={{ saveTranscript: preferences.saveSpeakingTranscripts, saveAudio: preferences.saveSpeakingAudio }}
              ai={
                status.available
                  ? { available: true, simulated: status.simulated, providerLabel: status.provider === "openai" ? "OpenAI 或兼容的 AI 服务" : status.provider, ...status.voice, unavailableReason: null }
                  : { available: false, simulated: false, providerLabel: "", realtime: false, transcription: false, speech: false, unavailableReason: AI_STATUS_LABELS[status.reason] }
              }
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>任务说明</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-[0.9375rem]">
              <p className="text-ink">{task.instructions_zh}</p>
              <p className="text-sm text-muted">能力目标：{task.can_do_zh}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge size="sm" tone="primary">
                  {CEFR_LEVEL_LABELS[task.level]}
                </Badge>
                <Badge size="sm">{SPEAKING_TYPE_LABELS[task.type]}</Badge>
              </div>
              {task.key_phrases.length > 0 ? (
                <div>
                  <p className="mb-1 text-sm font-semibold text-ink">可以用的句型</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {task.key_phrases.map((p) => (
                      <li key={p} lang="en" className="rounded-lg bg-surface-soft px-2 py-1 text-sm text-ink">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {task.type === "read_aloud" && task.items ? (
                <ol className="list-decimal pl-5 text-sm text-muted" lang="en">
                  {task.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ol>
              ) : null}
            </CardContent>
          </Card>
          {source ? (
            <Card>
              <CardHeader>
                <CardTitle>原文：{source.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <details open className="text-[0.9375rem]">
                  <summary className="cursor-pointer text-sm text-muted">显示 / 隐藏原文（复述时可以先收起来）</summary>
                  <div lang="en" className="mt-2 flex flex-col gap-1 text-ink">
                    {source.rows.map((r, i) => (
                      <p key={i}>
                        {r.speaker ? <span className="font-semibold">{r.speaker}: </span> : null}
                        {r.en}
                      </p>
                    ))}
                  </div>
                  <Link href={`/${source.type === "listening" ? "listening" : "reading"}/${source.id}`} className="mt-2 inline-block text-sm text-primary-ink underline">
                    去{source.type === "listening" ? "听力" : "阅读"}页面看完整材料
                  </Link>
                </details>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
