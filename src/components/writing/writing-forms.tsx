"use client";

import { RotateCcw, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteWritingAction, retryFeedbackAction, reviseWritingAction, submitWritingAction } from "@/modules/writing/actions";

const countWords = (t: string) => (t.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d+/g) ?? []).length;

function WordCount({ text, min, max }: { text: string; min: number; max: number }) {
  const n = countWords(text);
  return (
    <span className={cn("text-sm", n < min ? "text-muted" : n > max ? "text-coral-ink" : "text-mint-ink")} aria-live="polite">
      {n} 个词（建议 {min}–{max}）
    </span>
  );
}

/** Write the first version (built-in task or the learner's own topic). */
export function WritingEditor({ promptId, minWords, maxWords, custom }: { promptId: string | null; minWords: number; maxWords: number; custom: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await submitWritingAction({ promptId, custom: custom ? { title, task } : undefined, text });
          if (!r.ok) setError(r.error);
          else router.push(`/writing/${r.data.id}`);
        });
      }}
    >
      {custom ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-title`} className="text-sm font-medium text-ink">
              题目
            </label>
            <Input id={`${id}-title`} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="例如：我的城市" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-task`} className="text-sm font-medium text-ink">
              写作要求（AI 会按这个判断任务完成度）
            </label>
            <Input id={`${id}-task`} value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} placeholder="例如：介绍你住的城市，写 3 个你喜欢的地方" required />
          </div>
        </>
      ) : null}
      <label htmlFor={`${id}-text`} className="text-sm font-medium text-ink">
        你的英文
      </label>
      <textarea
        id={`${id}-text`}
        lang="en"
        rows={10}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WordCount text={text} min={minWords} max={maxWords} />
        <Button type="submit" disabled={pending || countWords(text) < 5}>
          <Send aria-hidden="true" />
          {pending ? "AI 正在看你的文章…" : "提交，看反馈"}
        </Button>
      </div>
      <p className="text-xs text-muted">提交后你的文章会先保存；AI 反馈失败也不会丢，可以稍后重试。文章内容会发送给你配置的 AI 服务。</p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </form>
  );
}

export function RetryFeedback({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await retryFeedbackAction(id);
              if (!r.ok) setError(r.error);
              else router.refresh();
            })
          }
        >
          <RotateCcw aria-hidden="true" />
          {pending ? "正在请求反馈…" : "重新请求反馈"}
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

/** The learner's own second version (prefilled with the first). */
export function RevisionForm({ id, original, minWords, maxWords }: { id: string; original: string; minWords: number; maxWords: number }) {
  const router = useRouter();
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldId = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await reviseWritingAction({ id, text });
          if (!r.ok) setError(r.error);
          else router.refresh();
        });
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        按反馈自己改一遍，写第二版
      </label>
      <textarea
        id={fieldId}
        lang="en"
        rows={10}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WordCount text={text} min={minWords} max={maxWords} />
        <Button type="submit" disabled={pending || text.trim() === original.trim()}>
          {pending ? "AI 正在对比…" : "提交第二版"}
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </form>
  );
}

export function DeleteWriting({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  return confirm ? (
    <span className="flex items-center gap-2 text-sm text-coral-ink">
      删除后不能恢复。
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await deleteWritingAction(id);
            if (r.ok) router.push("/writing");
          })
        }
      >
        确认删除
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
        取消
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
      <Trash2 aria-hidden="true" />
      删除这篇
    </Button>
  );
}
