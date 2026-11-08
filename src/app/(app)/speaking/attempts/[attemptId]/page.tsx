import { ArrowLeft, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { DeleteAttemptButton, DeleteAudioButton, RetryFeedbackButton } from "@/components/speaking/attempt-actions";
import { SpeakingFeedbackView } from "@/components/speaking/speaking-feedback";
import { TurnList } from "@/components/speaking/turn-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { SPEAKING_MODE_LABELS, SPEAKING_TYPE_LABELS, isScripted } from "@/modules/speaking/content";
import { SpeakingNotFoundError, getSpeakingAttempt } from "@/modules/speaking/services/speaking";

export const metadata: Metadata = { title: "Speaking feedback" };

const END_REASONS: Record<string, string> = { completed: "完成", user: "手动结束", disconnected: "连接中断后结束", time_limit: "到达时长上限", error: "出错后结束" };

export default function SpeakingAttemptPage({ params, searchParams }: PageProps<"/speaking/attempts/[attemptId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
      <AttemptLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AttemptLoader({ params, searchParams }: PageProps<"/speaking/attempts/[attemptId]">) {
  const [{ attemptId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const user = await requireOwner();
  const db = getDb();
  const data = await getSpeakingAttempt(db, user.id, attemptId).catch((e: unknown) => {
    if (e instanceof SpeakingNotFoundError) return null;
    throw e;
  });
  if (!data) notFound();
  const { attempt: a, task, evaluation, media } = data;
  const { profile } = await getLearnerSettings(db, user.id);
  const feedbackError = typeof query.feedback === "string" && !evaluation ? query.feedback.slice(0, 300) : null;
  const scripted = task ? isScripted(task.type) : false;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/speaking" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            口语 · 练习记录
          </Link>
        }
        title={task?.title_en ?? a.promptId}
        titleZh={task?.title_zh ?? "口语练习"}
        description={`${a.createdAt.toLocaleString("zh-CN", { timeZone: profile.timezone })} · ${SPEAKING_MODE_LABELS[a.mode as "typed"] ?? a.mode}${a.provider === "mock" ? "（模拟 AI）" : ""} · 老师按 ${a.level} 水平说话`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>反馈</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {a.status === "active" ? (
              <p className="text-sm text-muted">这次练习没有正常结束（比如中途离开了页面），所以没有反馈。</p>
            ) : evaluation ? (
              <SpeakingFeedbackView feedback={evaluation} />
            ) : (
              <>
                <FormMessage tone="error">{feedbackError ?? "这次练习还没有反馈。"}</FormMessage>
                {a.transcript.length > 0 ? <RetryFeedbackButton id={a.id} /> : <p className="text-sm text-muted">没有保存转录，所以没法再生成反馈。</p>}
              </>
            )}
            {task ? (
              <div>
                <Button asChild variant="outline">
                  <Link href={`/speaking/${task.id}`}>
                    <RotateCcw aria-hidden="true" />
                    再练一次
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>这次练习</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {task ? <Badge size="sm">{SPEAKING_TYPE_LABELS[task.type]}</Badge> : null}
                <Badge size="sm" tone="outline">
                  说了 {a.learnerTurns} 次 · 约 {a.learnerWords} 个词
                </Badge>
                {a.durationSeconds !== null ? (
                  <Badge size="sm" tone="outline">
                    {a.durationSeconds < 60 ? `${a.durationSeconds} 秒` : `${Math.round(a.durationSeconds / 60)} 分钟`}
                  </Badge>
                ) : null}
                {a.endReason ? (
                  <Badge size="sm" tone="outline">
                    {END_REASONS[a.endReason] ?? a.endReason}
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted" data-testid="privacy-summary">
                转录：{a.saveTranscript ? "已保存" : "没有保存"} · 录音：{a.saveAudio ? (media.length > 0 ? `已保存 ${media.length} 段` : "已删除或没有录到") : "没有保存"}
              </p>
              {media.length > 0 ? (
                <div className="flex flex-col gap-2" data-testid="recordings">
                  {media.map((m, i) => (
                    <div key={m.id} className="flex flex-col gap-1">
                      <span className="text-xs text-muted">{scripted || a.mode !== "realtime" ? `第 ${i + 1} 段` : "你的麦克风录音（整段）"}</span>
                      <audio controls preload="none" src={`/api/media/${m.id}`} className="h-10 w-full" />
                    </div>
                  ))}
                  <div>
                    <DeleteAudioButton id={a.id} count={media.length} />
                  </div>
                </div>
              ) : null}
              <div>
                <DeleteAttemptButton id={a.id} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>逐轮转录</CardTitle>
            </CardHeader>
            <CardContent>
              {a.transcript.length > 0 ? (
                <TurnList
                  turns={a.transcript.map((t, i) => ({
                    id: String(i),
                    role: t.role,
                    text: t.text,
                    interrupted: t.interrupted,
                    note: t.item !== undefined && task?.items?.[t.item] ? `第 ${t.item + 1} 句：${task.items[t.item]}${t.score !== undefined ? `（识别出 ${Math.round(t.score * 100)}%）` : ""}` : undefined,
                  }))}
                  emptyText=""
                />
              ) : (
                <p className="text-sm text-muted">{a.saveTranscript ? "没有录到对话内容。" : "这次选择了不保存转录。"}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
