"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { deleteAllTutorSessionsAction } from "@/modules/ai/actions";
import { updateLearnerSettingsAction } from "@/modules/learner/actions";

/** Settings → AI: keep conversations or not, and delete them all (spec §11.2). */
export function AiPrivacyControls({ save, sessions }: { save: boolean; sessions: number }) {
  const router = useRouter();
  const [value, setValue] = useState(save);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={value}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setValue(next);
            startTransition(async () => {
              const r = await updateLearnerSettingsAction({ preferences: { saveAiConversations: next } });
              setMessage(r.ok ? (next ? "以后的 AI 对话会保存，可以随时删除。" : "以后的 AI 对话不再保存。已保存的对话不受影响，可以在下面删除。") : r.error);
            });
          }}
        />
        保存 AI 对话（关闭后，每次回复完不会在数据库里留下对话内容）
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">已保存 {sessions} 段对话</span>
        {sessions > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteAllTutorSessionsAction();
                setMessage(r.ok ? `已删除 ${r.data} 段对话。` : r.error);
                router.refresh();
              })
            }
          >
            删除全部 AI 对话
          </Button>
        ) : null}
      </div>
      {message ? <FormMessage tone="success">{message}</FormMessage> : null}
    </div>
  );
}
