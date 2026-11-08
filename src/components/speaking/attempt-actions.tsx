"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { updateLearnerSettingsAction } from "@/modules/learner/actions";
import { deleteAllSpeakingAction, deleteSpeakingAttemptAction, deleteSpeakingAudioAction, retrySpeakingFeedbackAction } from "@/modules/speaking/actions";

export function RetryFeedbackButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await retrySpeakingFeedbackAction(id);
              if (!r.ok) setError(r.error);
              else router.replace(`/speaking/attempts/${id}`);
            })
          }
        >
          <RotateCcw aria-hidden="true" />
          {pending ? "正在生成反馈…" : "重新生成反馈"}
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

export function DeleteAudioButton({ id, count }: { id: string; count: number }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost">
          <Trash2 aria-hidden="true" />
          删除录音
        </Button>
      }
      title="删除这次的录音？"
      description={`会从服务器上删除 ${count} 段录音文件，无法恢复。转录和反馈会保留。`}
      confirmLabel="删除录音"
      tone="danger"
      action={async () => {
        await deleteSpeakingAudioAction(id);
        router.refresh();
      }}
    />
  );
}

export function DeleteAttemptButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost">
          <Trash2 aria-hidden="true" />
          删除这次练习
        </Button>
      }
      title="删除这次口语练习？"
      description="转录、反馈和录音文件都会删除，无法恢复。错误本里已经记下的条目会保留。"
      confirmLabel="删除"
      tone="danger"
      action={async () => {
        const r = await deleteSpeakingAttemptAction(id);
        if (r.ok) router.push("/speaking");
      }}
    />
  );
}

/** Settings → privacy: speaking defaults and deleting everything (spec §11.2). */
export function SpeakingPrivacyControls({ saveAudio, saveTranscripts, sessions, recordings }: { saveAudio: boolean; saveTranscripts: boolean; sessions: number; recordings: number }) {
  const router = useRouter();
  const [audio, setAudio] = useState(saveAudio);
  const [transcripts, setTranscripts] = useState(saveTranscripts);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (patch: { saveSpeakingAudio?: boolean; saveSpeakingTranscripts?: boolean }) =>
    startTransition(async () => {
      const r = await updateLearnerSettingsAction({ preferences: patch });
      setMessage(r.ok ? "已保存。每次开始口语练习前还可以单独选择。" : r.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={transcripts}
          disabled={pending}
          onChange={(e) => {
            setTranscripts(e.target.checked);
            save({ saveSpeakingTranscripts: e.target.checked });
          }}
        />
        口语练习默认保存文字转录
      </label>
      <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={audio}
          disabled={pending}
          onChange={(e) => {
            setAudio(e.target.checked);
            save({ saveSpeakingAudio: e.target.checked });
          }}
        />
        口语练习默认保存录音（关闭 = 自动保存语音关闭）
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">
          已保存 {sessions} 次口语练习、{recordings} 段录音
        </span>
        {sessions > 0 ? (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost">
                删除全部口语记录
              </Button>
            }
            title="删除全部口语记录？"
            description="所有口语练习的转录、反馈和录音文件都会删除，无法恢复。"
            confirmLabel="全部删除"
            tone="danger"
            action={async () => {
              const r = await deleteAllSpeakingAction();
              if (r.ok) setMessage(`已删除 ${r.data.sessions} 次练习、${r.data.recordings} 段录音。`);
              router.refresh();
            }}
          />
        ) : null}
      </div>
      {message ? <FormMessage tone="success">{message}</FormMessage> : null}
    </div>
  );
}
