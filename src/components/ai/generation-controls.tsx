"use client";

import { CircleCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { discardGenerationAction, generateEnrichmentAction, generateGradedReadingAction, generateMicroLessonAction, publishGenerationAction } from "@/modules/ai/generation-actions";

/** Library: ask the AI for an original graded text at a chosen level (result is a draft). */
export function GenerateReadingForm({ levels, defaultLevel }: { levels: { value: string; label: string }[]; defaultLevel: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState(defaultLevel);
  const [type, setType] = useState<"reading" | "listening">("reading");
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
          const r = await generateGradedReadingAction({ topic, level: level as never, type });
          if (!r.ok) setError(r.error);
          else router.push(`/library/ai/${r.data}`);
        });
      }}
    >
      <SegmentedControl<"reading" | "listening">
        ariaLabel="生成类型"
        size="sm"
        value={type}
        onValueChange={setType}
        options={[
          { value: "reading", label: "短文" },
          { value: "listening", label: "对话（听力）" },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-topic`} className="text-sm font-medium text-ink">
            话题
          </label>
          <Input id={`${id}-topic`} value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} placeholder="例如：cooking / 坐地铁 / a rainy day" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-level`} className="text-sm font-medium text-ink">
            等级
          </label>
          <select id={`${id}-level`} value={level} onChange={(e) => setLevel(e.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.9375rem] text-ink">
            {levels.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted">AI 只写虚构故事或日常场景，不写事实说明。生成后先进入草稿：自动检查句长、生词和题目，你看过预览再决定是否加入学习库。</p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending || !topic.trim()}>
          <Sparkles aria-hidden="true" />
          {pending ? "AI 正在写…" : "生成草稿"}
        </Button>
      </div>
    </form>
  );
}

/** Preview page: confirm or discard a generated draft. */
export function GenerationReview({ id, kind }: { id: string; kind: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await publishGenerationAction(id);
              if (!r.ok) setError(r.error);
              else if ("contentId" in r.data && r.data.contentId) router.push(`/${r.data.type}/${r.data.contentId}`);
              else router.refresh();
            })
          }
        >
          <CircleCheck aria-hidden="true" />
          {kind === "material_enrichment" ? "确认，加到这份材料上" : "确认，加入学习库"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await discardGenerationAction(id);
              if (!r.ok) setError(r.error);
              else router.push("/library");
            })
          }
        >
          不要这份草稿
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

/** Imported material without glossary/questions: let the AI propose them (as a draft). */
export function EnrichButton({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="soft"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await generateEnrichmentAction(contentId);
            if (!r.ok) setError(r.error);
            else router.push(`/library/ai/${r.data}`);
          })
        }
      >
        <Sparkles aria-hidden="true" />
        {pending ? "AI 正在整理…" : "AI 生成生词表和理解题"}
      </Button>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

/** Error notebook: generate (or practise) a short AI lesson for this error. */
export function MicroLessonActions({ errorItemId, draftId }: { errorItemId: string; draftId: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {draftId ? (
          <>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await publishGenerationAction(draftId);
                  if (!r.ok) setError(r.error);
                  else router.refresh();
                })
              }
            >
              开始练习这 3 道题
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await discardGenerationAction(draftId);
                  router.refresh();
                })
              }
            >
              不要这份微课
            </Button>
          </>
        ) : (
          <Button
            variant="soft"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await generateMicroLessonAction(errorItemId);
                if (!r.ok) setError(r.error);
                else router.refresh();
              })
            }
          >
            <Sparkles aria-hidden="true" />
            {pending ? "AI 正在准备…" : "生成 AI 微课"}
          </Button>
        )}
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
