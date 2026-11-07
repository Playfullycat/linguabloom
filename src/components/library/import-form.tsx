"use client";

import { BookOpen, Headphones, ListPlus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

type Purpose = "reading" | "listening" | "vocabulary";

const PURPOSE_HELP: Record<Purpose, { accept: string; hint: string; placeholder: string }> = {
  reading: {
    accept: ".txt,.md,.markdown,.srt,.vtt",
    hint: "粘贴英文文章，或上传 TXT / Markdown（也可以用 SRT / VTT 字幕当阅读材料）。会自动按段落和句子切分。",
    placeholder: "把英文文章粘贴到这里……",
  },
  listening: {
    accept: ".srt,.vtt,.txt,.md",
    hint: "上传 SRT / VTT 字幕，再配上音频，就能逐句播放、单句循环和 A-B 循环。只有文本、没有音频时用浏览器朗读。",
    placeholder: "粘贴对话或字幕内容……",
  },
  vocabulary: {
    accept: ".csv,.tsv",
    hint: "CSV / TSV 词表，或直接粘贴（每行“单词,释义”或用 Tab 分隔）。有表头时按列名识别：word、meaning、example、ipa、pos。",
    placeholder: "apple,苹果\nborrow,借（入）",
  },
};

/**
 * Step 1–2 of the importer (spec §5.14): purpose, source, copyright. The
 * server parses it into a draft; the learner then checks the preview.
 */
export function ImportForm({ copyrightOptions }: { copyrightOptions: { value: string; label: string }[] }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState<Purpose>("reading");
  const [copyright, setCopyright] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const help = PURPOSE_HELP[purpose];

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        form.set("purpose", purpose);
        if (copyright) form.set("copyrightStatus", copyright);
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/import", { method: "POST", body: form });
          const data = (await res.json().catch(() => null)) as { ok: boolean; importId?: string; error?: string } | null;
          if (!data?.ok) setError(data?.error ?? "导入失败，请重试。");
          else router.push(`/library/${data.importId}`);
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink" id={`${id}-purpose`}>
          导入来做什么？
        </span>
        <SegmentedControl<Purpose>
          ariaLabel="导入用途"
          value={purpose}
          onValueChange={setPurpose}
          options={[
            { value: "reading", label: (<span className="inline-flex items-center gap-1.5"><BookOpen aria-hidden="true" />阅读</span>), ariaLabel: "阅读" },
            { value: "listening", label: (<span className="inline-flex items-center gap-1.5"><Headphones aria-hidden="true" />听力</span>), ariaLabel: "听力" },
            { value: "vocabulary", label: (<span className="inline-flex items-center gap-1.5"><ListPlus aria-hidden="true" />词表</span>), ariaLabel: "词表" },
          ]}
        />
        <p className="text-sm text-muted">{help.hint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-title`} className="text-sm font-medium text-ink">
          标题
        </label>
        <Input id={`${id}-title`} name="title" required maxLength={120} placeholder={purpose === "vocabulary" ? "例如：工作常用词" : "例如：BBC 学英语笔记"} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-text`} className="text-sm font-medium text-ink">
          粘贴内容
        </label>
        <textarea
          id={`${id}-text`}
          name="text"
          lang="en"
          rows={6}
          placeholder={help.placeholder}
          className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 py-3 font-mono text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-ring"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-file`} className="text-sm font-medium text-ink">
          或者选择文件（最多 2 MB，选了文件就以文件为准）
        </label>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept={help.accept}
          className="text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-primary-ink"
        />
      </div>
      {purpose === "listening" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-audio`} className="text-sm font-medium text-ink">
            音频（可选，最多 50 MB：MP3、M4A、OGG、WAV、WebM）
          </label>
          <input
            id={`${id}-audio`}
            name="audio"
            type="file"
            accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/x-wav,audio/webm,.mp3,.m4a,.ogg,.wav,.webm"
            className="text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-primary-ink"
          />
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">版权状态（必选）</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {copyrightOptions.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                copyright === o.value ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink",
              )}
            >
              <input type="radio" name="copyright" className="sr-only" checked={copyright === o.value} onChange={() => setCopyright(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">只导入你有权使用的材料。导入内容只给你自己学习，不会公开或分享。不支持绕过付费、DRM 或访问限制。</p>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
          来源备注（可选）
        </label>
        <Input id={`${id}-note`} name="sourceNote" maxLength={500} placeholder="例如：自己的英语日记 / 某网站，CC BY 4.0" />
      </div>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending || !copyright}>
          <Upload aria-hidden="true" />
          {pending ? "正在解析…" : "解析并预览"}
        </Button>
      </div>
    </form>
  );
}
