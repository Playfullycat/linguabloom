"use client";

import { BookmarkPlus, Check, MessageSquarePlus, Send, SpellCheck2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
import { addTutorWordAction, deleteAllTutorSessionsAction, deleteTutorSessionAction, loadTutorSessionAction, tutorReplyAction } from "@/modules/ai/actions";
import type { TutorReply } from "@/modules/ai/tutor/schema";

type Mode = "explain" | "practice" | "conversation" | "roleplay" | "correct" | "ask_me" | "review" | "reading_coach" | "listening_coach";
type Msg = { id: string; role: "user" | "assistant"; content: string; reply: TutorReply | null; check?: TutorReply | null };

export type TutorChatProps = {
  modes: { value: Mode; title: string; titleEn: string; description: string; structured: boolean; placeholder: string }[];
  scenes: { id: string; title: string }[];
  initialMode: Mode;
  material: { contentId: string; seq: number | null; title: string; type: "reading" | "listening" } | null;
  level: string;
  levelBasis: string;
  simulated: boolean;
  saveConversations: boolean;
  sessions: { id: string; title: string; mode: string; startedAt: string; messages: number }[];
};

let counter = 0;
const uid = () => `m${++counter}`;

function ReplyBlocks({ reply, onAdd }: { reply: TutorReply; onAdd: (w: TutorReply["new_vocabulary"][number]) => Promise<string> }) {
  const [added, setAdded] = useState<Record<string, string>>({});
  return (
    <div className="mt-2 flex flex-col gap-2">
      {reply.correction ? (
        <div className="rounded-xl bg-surface p-3 text-sm">
          <p className="font-medium text-ink">纠错</p>
          <p lang="en" className="mt-1">
            <span className="sr-only">原句：</span>
            <span className="text-coral-ink line-through decoration-coral/60">{reply.correction.original}</span>
          </p>
          <p lang="en" className="text-mint-ink">
            <span className="sr-only">改为：</span>✓ {reply.correction.corrected}
          </p>
          {reply.correction.explanation_zh ? <p className="mt-1 text-muted">{reply.correction.explanation_zh}</p> : null}
          {reply.correction.explanation_en ? (
            <p lang="en" className="text-muted">
              {reply.correction.explanation_en}
            </p>
          ) : null}
        </div>
      ) : null}
      {reply.new_vocabulary.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">新词</p>
          <ul className="flex flex-wrap gap-2">
            {reply.new_vocabulary.map((w) => (
              <li key={w.text} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-sm">
                <span lang="en" className="font-medium text-ink">
                  {w.text}
                </span>
                <span className="text-muted">{w.zh}</span>
                {added[w.text] ? (
                  <span className="inline-flex items-center gap-1 text-mint-ink">
                    <Check className="size-3.5" aria-hidden="true" />
                    {added[w.text]}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    aria-label={`加入词汇库：${w.text}`}
                    onClick={async () => {
                      const msg = await onAdd(w);
                      setAdded((a) => ({ ...a, [w.text]: msg }));
                    }}
                  >
                    <BookmarkPlus aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reply.follow_up_question ? (
        <p lang="en" className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary-ink">
          <span className="sr-only">追问：</span>
          {reply.follow_up_question}
        </p>
      ) : null}
      {reply.suggested_practice.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-sm">
          {reply.suggested_practice.map((p) => (
            <li key={p.title}>{p.href ? <Link href={p.href} className="text-primary-ink underline-offset-4 hover:underline">{p.title}</Link> : <span className="text-muted">{p.title}</span>}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * AI Tutor (spec §5.9): pick a mode, talk. Teaching modes show corrections,
 * new words and a follow-up question; conversation and roleplay stream text.
 */
export function TutorChat(props: TutorChatProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(props.initialMode);
  const [scene, setScene] = useState(props.scenes[0]!.id);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState({ level: props.level, basis: props.levelBasis });
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);
  const inputId = useId();
  const info = props.modes.find((m) => m.value === mode)!;

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const reset = (next?: Mode) => {
    if (next) setMode(next);
    setMessages([]);
    setSessionId(null);
    setError(null);
  };

  const history = () => messages.map((m) => ({ role: m.role, content: m.content }));
  const material = props.material && (mode === "reading_coach" || mode === "listening_coach") ? { contentId: props.material.contentId, seq: props.material.seq } : undefined;

  const addWord = async (w: TutorReply["new_vocabulary"][number]) => {
    const r = await addTutorWordAction({ text: w.text, zh: w.zh, example: w.example });
    return r.ok ? (r.data.added ? "已加入" : "已在词汇库") : "没加上";
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setInput("");
    const userMsg: Msg = { id: uid(), role: "user", content: message, reply: null };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    const req = { mode, message, history: sessionId ? [] : history(), sessionId, scene: mode === "roleplay" ? scene : undefined, material };
    try {
      if (info.structured) {
        const r = await tutorReplyAction(req);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setLevel({ level: r.data.level, basis: r.data.levelBasis });
        if (r.data.sessionId) setSessionId(r.data.sessionId);
        setMessages((m) => [...m, { id: uid(), role: "assistant", content: r.data.reply.response_text, reply: r.data.reply }]);
      } else {
        const res = await fetch("/api/ai/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? "AI 请求失败了，请稍后再试。");
          return;
        }
        const id = uid();
        setMessages((m) => [...m, { id, role: "assistant", content: "", reply: null }]);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            const ev = JSON.parse(l) as { t: string; text?: string; sessionId?: string | null; error?: string; level?: string; levelBasis?: string };
            if (ev.t === "delta") setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: x.content + ev.text } : x)));
            else if (ev.t === "meta") setLevel({ level: ev.level!, basis: ev.levelBasis! });
            else if (ev.t === "done" && ev.sessionId) setSessionId(ev.sessionId);
            else if (ev.t === "error") {
              setError(ev.error ?? "AI 请求失败了。");
              setMessages((m) => m.filter((x) => x.id !== id || x.content));
            }
          }
        }
      }
    } catch {
      setError("连接中断了，请重试。");
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  /** Conversation/roleplay don't correct every slip: check the last sentence on request. */
  const checkLast = (msg: Msg) => {
    setError(null);
    startTransition(async () => {
      const r = await tutorReplyAction({ mode: "correct", message: msg.content, history: [], sessionId: null, check: true });
      if (!r.ok) setError(r.error);
      else setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, check: r.data.reply } : x)));
    });
  };

  const openSession = (id: string) =>
    startTransition(async () => {
      const r = await loadTutorSessionAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setMode(r.data.session.sessionType as Mode);
      setSessionId(id);
      setMessages(r.data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, reply: m.reply })));
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <fieldset>
          <legend className="sr-only">选择模式</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {props.modes.map((m) => (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer flex-col rounded-xl border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  mode === m.value ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-soft",
                  (m.value === "reading_coach" || m.value === "listening_coach") && !props.material && "opacity-60",
                )}
              >
                <input type="radio" name="tutor-mode" className="sr-only" checked={mode === m.value} onChange={() => reset(m.value)} />
                <span className="text-sm font-medium text-ink">
                  {m.title} <span lang="en" className="text-xs font-normal text-muted">{m.titleEn}</span>
                </span>
                <span className="text-xs text-muted">{m.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex min-h-[28rem] flex-col rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <span className="font-semibold text-ink">{info.title}</span>
            <Badge size="sm" tone="primary">
              按 {level.level} 调整（依据：{level.basis}）
            </Badge>
            {props.simulated ? (
              <Badge size="sm" tone="yellow">
                模拟 AI：未连接真实服务
              </Badge>
            ) : null}
            {mode === "roleplay" ? (
              <label className="ml-auto flex items-center gap-2 text-sm text-ink">
                场景
                <select value={scene} onChange={(e) => {
                    reset();
                    setScene(e.target.value);
                  }} className="h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm">
                  {props.scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {messages.length > 0 ? (
              <Button size="sm" variant="ghost" className={mode === "roleplay" ? "" : "ml-auto"} onClick={() => reset()}>
                <MessageSquarePlus aria-hidden="true" />
                新对话
              </Button>
            ) : null}
          </div>
          {(mode === "reading_coach" || mode === "listening_coach") && props.material ? (
            <p className="border-b border-border bg-blue-soft px-4 py-2 text-sm text-blue-ink">
              正在陪你{props.material.type === "listening" ? "听" : "读"}：<span lang="en">{props.material.title}</span>
              {props.material.seq !== null ? `（第 ${props.material.seq + 1} 句附近）` : ""}
            </p>
          ) : (mode === "reading_coach" || mode === "listening_coach") ? (
            <p className="border-b border-border bg-yellow-soft px-4 py-2 text-sm text-yellow-ink">先打开一篇阅读或听力材料，再点“问 AI”，教练才知道你在看哪一段。</p>
          ) : null}

          <ol ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-label="对话" aria-live="polite">
            {messages.length === 0 ? <li className="m-auto max-w-sm text-center text-sm text-muted">{info.description} 在下面输入开始。</li> : null}
            {messages.map((m, i) => (
              <li key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.9375rem]", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-soft text-ink")}>
                  <span className="sr-only">{m.role === "user" ? "你：" : "AI："}</span>
                  <p lang="en" className="whitespace-pre-wrap">
                    {m.content || (busy && i === messages.length - 1 ? "…" : "")}
                  </p>
                  {m.reply ? <ReplyBlocks reply={m.reply} onAdd={addWord} /> : null}
                </div>
                {m.role === "user" && !info.structured ? (
                  m.check ? (
                    <div className="mt-1 max-w-[85%] text-sm">
                      {m.check.correction ? <ReplyBlocks reply={{ ...m.check, new_vocabulary: [], follow_up_question: null, suggested_practice: [] }} onAdd={addWord} /> : <p className="text-mint-ink">这句没有明显的错误。</p>}
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="mt-1 h-7 text-xs" disabled={pending} onClick={() => checkLast(m)}>
                      <SpellCheck2 aria-hidden="true" />
                      检查这句
                    </Button>
                  )
                ) : null}
              </li>
            ))}
            {busy && info.structured ? (
              <li className="text-sm text-muted" role="status">
                AI 正在回复…
              </li>
            ) : null}
          </ol>

          {error ? (
            <FormMessage tone="error" className="mx-4 mb-2">
              {error}
            </FormMessage>
          ) : null}
          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              你的消息
            </label>
            <textarea
              id={inputId}
              lang="en"
              rows={2}
              maxLength={2000}
              value={input}
              placeholder={info.placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              className="min-h-11 flex-1 resize-none rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-2.5 text-[0.9375rem] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-ring"
            />
            <Button type="submit" disabled={busy || !input.trim()} aria-label="发送">
              <Send aria-hidden="true" />
            </Button>
          </form>
        </div>
        <p className="text-xs text-muted">
          发送给 AI 服务的内容：你的消息、这段对话最近 12 条、你的大致水平和讲解语言；复习模式另加最近的词和薄弱点，教练模式另加当前材料的几句原文。
          {props.saveConversations ? "对话会保存在你的数据库里，可以随时删除；" : "对话不会保存；"}
          可以在“设置 → AI 服务”里修改。
        </p>
      </div>

      <aside className="flex flex-col gap-3" aria-label="保存的对话">
        <h2 className="text-sm font-semibold text-ink">保存的对话</h2>
        {props.sessions.length === 0 ? (
          <p className="text-sm text-muted">{props.saveConversations ? "还没有保存的对话。" : "已关闭对话保存。"}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {props.sessions.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-1 rounded-xl border px-2 py-1.5", s.id === sessionId ? "border-primary bg-primary-soft" : "border-border bg-surface")}>
                <button type="button" onClick={() => openSession(s.id)} className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline">
                  {s.title}
                  <span className="block text-xs text-muted">
                    {props.modes.find((m) => m.value === s.mode)?.title ?? s.mode} · {s.messages} 条 · {s.startedAt}
                  </span>
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`删除对话：${s.title}`}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await deleteTutorSessionAction(s.id);
                      if (!r.ok) setError(r.error);
                      else {
                        if (s.id === sessionId) reset();
                        router.refresh();
                      }
                    })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {props.sessions.length > 1 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              startTransition(async () => {
                await deleteAllTutorSessionsAction();
                reset();
                router.refresh();
              })
            }
          >
            删除全部对话
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
