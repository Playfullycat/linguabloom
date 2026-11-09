"use client";

import { BookCheck, BookmarkPlus, BookOpen, LoaderCircle, Undo2 } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { logReadingAction, setBookStatusAction, type Result } from "@/modules/books/actions";

type Status = "want" | "reading" | "finished" | null;

/** Shelf buttons for one book: want to read / start reading / finished / take off the shelf. */
export function BookShelfButtons({ bookId, title, status }: { bookId: string; title: string; status: Status }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (next: Status) =>
    startTransition(async () => {
      setError(null);
      const r: Result = await setBookStatusAction({ bookId, status: next });
      if (!r.ok) setError(r.error);
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === null ? (
          <>
            <Button size="sm" variant="soft" disabled={pending} onClick={() => set("reading")} aria-label={`开始读：${title}`}>
              <BookOpen aria-hidden="true" />
              开始读
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => set("want")} aria-label={`加入想读：${title}`}>
              <BookmarkPlus aria-hidden="true" />
              想读
            </Button>
          </>
        ) : null}
        {status === "want" ? (
          <Button size="sm" variant="soft" disabled={pending} onClick={() => set("reading")} aria-label={`开始读：${title}`}>
            <BookOpen aria-hidden="true" />
            开始读
          </Button>
        ) : null}
        {status === "reading" ? (
          <Button size="sm" variant="soft" disabled={pending} onClick={() => set("finished")} aria-label={`读完了：${title}`}>
            <BookCheck aria-hidden="true" />
            读完了
          </Button>
        ) : null}
        {status === "finished" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("reading")} aria-label={`重新开始读：${title}`}>
            <BookOpen aria-hidden="true" />
            再读一遍
          </Button>
        ) : null}
        {status !== null ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => set(null)} aria-label={`从书架移除：${title}`}>
            <Undo2 aria-hidden="true" />
            移出书架
          </Button>
        ) : null}
        {pending ? <LoaderCircle className="size-4 animate-spin self-center text-muted" aria-label="正在保存" /> : null}
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

/** Log a reading session (minutes, optional pages). */
export function ReadingLogForm({ bookId, title }: { bookId: string; title: string }) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [minutes, setMinutes] = useState("20");
  const [pages, setPages] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const requestId = useRef<string | null>(null);

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      requestId.current ??= crypto.randomUUID();
      const r = await logReadingAction({
        bookId,
        minutes: Number(minutes),
        pages: pages.trim() ? Number(pages) : null,
        clientRequestId: requestId.current,
      });
      if (!r.ok) {
        setMessage({ tone: "error", text: r.error });
        return;
      }
      requestId.current = null;
      setPages("");
      setMessage({ tone: "success", text: `记下了 ${minutes} 分钟，已计入本周的阅读输入。` });
    });

  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-surface-soft p-3"
      aria-label={`记录阅读：${title}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted" htmlFor={`${id}-min`}>
          读了几分钟
          <input
            id={`${id}-min`}
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            required
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-10 w-24 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted" htmlFor={`${id}-pages`}>
          页数（可不填）
          <input
            id={`${id}-pages`}
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            className="h-10 w-24 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-ink"
          />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          记录
        </Button>
      </div>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </form>
  );
}
