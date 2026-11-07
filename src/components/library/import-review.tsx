"use client";

import { CircleCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { deleteImportedMaterialAction, discardImportAction, publishImportAction } from "@/modules/imports/actions";

/** Step 3: confirm the preview (level, title) or discard the draft. */
export function ImportConfirm({
  importId,
  title,
  suggestedLevel,
  levels,
  disabled,
  isWords,
}: {
  importId: string;
  title: string;
  suggestedLevel: string | null;
  levels: { value: string; label: string }[];
  disabled: boolean;
  isWords: boolean;
}) {
  const router = useRouter();
  const [level, setLevel] = useState(suggestedLevel ?? "a1");
  const [name, setName] = useState(title);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className="text-sm font-medium text-ink">
            标题
          </label>
          <Input id={`${id}-title`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-level`} className="text-sm font-medium text-ink">
            {isWords ? "这些词大致属于哪个等级" : "等级（建议值按句长粗略估计，可以改）"}
          </label>
          <select
            id={`${id}-level`}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-ring"
          >
            {levels.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
                {l.value === suggestedLevel ? "（建议）" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || pending}
          onClick={() =>
            startTransition(async () => {
              const r = await publishImportAction({ id: importId, level: level as never, title: name });
              if (!r.ok) {
                setMessage({ tone: "error", text: r.error });
                return;
              }
              if (r.data.kind === "words") {
                setMessage({ tone: "success", text: `已加入词汇库 ${r.data.added} 个词${r.data.skipped > 0 ? `，跳过 ${r.data.skipped} 个已有的词` : ""}，会出现在复习里。` });
                router.refresh();
              } else router.push(`/${r.data.type}/${r.data.contentId}`);
            })
          }
        >
          <CircleCheck aria-hidden="true" />
          确认导入
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await discardImportAction(importId);
              if (!r.ok) setMessage({ tone: "error", text: r.error });
              else router.push("/library");
            })
          }
        >
          放弃这份草稿
        </Button>
      </div>
    </div>
  );
}

export function DeleteImported({ importId, title }: { importId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`删除：${title}`}>
        <Trash2 aria-hidden="true" />
        删除
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`确认删除：${title}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-coral-soft px-3 py-2 text-sm text-coral-ink">
      <span>删除后，这份材料、你在上面的学习记录和音频都会删掉，不能恢复。</span>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await deleteImportedMaterialAction(importId);
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
      >
        确认删除
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        取消
      </Button>
      {error ? <span>{error}</span> : null}
    </div>
  );
}
