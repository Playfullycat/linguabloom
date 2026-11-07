import { z } from "zod";

import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { InvalidAudioError } from "@/lib/storage";
import { IMPORT_LIMITS } from "@/modules/imports/domain/parse";
import { COPYRIGHT_STATUSES, IMPORT_PURPOSES, ImportRejectedError, createDraft, type SourceKind } from "@/modules/imports/services/imports";

/**
 * Create an import draft from pasted text or an uploaded file (+ optional
 * audio). Multipart, so large audio doesn't go through a server action.
 * Nothing reaches the learning library until the learner confirms.
 */

const fields = z.object({
  purpose: z.enum(IMPORT_PURPOSES),
  title: z.string().trim().min(1, "请填写标题").max(120),
  copyrightStatus: z.enum(COPYRIGHT_STATUSES, { message: "请选择版权状态" }),
  sourceNote: z.string().max(500).optional(),
  text: z.string().max(IMPORT_LIMITS.textChars * 2).optional(),
});

const EXTENSIONS: Record<string, SourceKind> = { txt: "txt", md: "markdown", markdown: "markdown", srt: "srt", vtt: "vtt", csv: "csv", tsv: "tsv" };

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers may omit it; cookies are SameSite=Lax anyway
  const allowed = new Set([new URL(getEnv().APP_URL).origin, new URL(request.url).origin]);
  return allowed.has(origin);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("请先登录。", 401);
  if (!sameOrigin(request)) return fail("请求来源不正确。", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("上传的数据读不出来，请重试。");
  }
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
  const parsed = fields.safeParse({ purpose: str("purpose"), title: str("title"), copyrightStatus: str("copyrightStatus"), sourceNote: str("sourceNote") || undefined, text: str("text") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "提交的内容格式不正确。");

  let text = parsed.data.text ?? "";
  let sourceKind: SourceKind = "paste";
  let fileName: string | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > IMPORT_LIMITS.fileBytes) return fail("文件太大了（最多 2 MB）。");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const kind = EXTENSIONS[ext];
    if (!kind) return fail("不支持这种文件。可以导入 TXT、Markdown、SRT、VTT、CSV 或 TSV。");
    sourceKind = kind;
    fileName = file.name;
    text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
  }
  if (!text.trim()) return fail("请粘贴文本或选择一个文件。");

  let audio: { type: string; name: string; bytes: Uint8Array } | null = null;
  const audioFile = form.get("audio");
  if (audioFile instanceof File && audioFile.size > 0) {
    if (audioFile.size > IMPORT_LIMITS.audioBytes) return fail("音频文件太大了（最多 50 MB）。");
    audio = { type: audioFile.type, name: audioFile.name, bytes: new Uint8Array(await audioFile.arrayBuffer()) };
  }

  try {
    const importId = await createDraft(getDb(), user.id, {
      purpose: parsed.data.purpose,
      sourceKind,
      title: parsed.data.title,
      fileName,
      text,
      copyrightStatus: parsed.data.copyrightStatus,
      sourceNote: parsed.data.sourceNote ?? null,
      audio,
    });
    return Response.json({ ok: true, importId });
  } catch (error) {
    if (error instanceof InvalidAudioError) return fail("音频格式不支持，或者文件内容和格式不符。可以用 MP3、M4A、OGG、WAV 或 WebM。");
    if (error instanceof ImportRejectedError) {
      return fail(parsed.data.purpose === "vocabulary" ? "词表只能用粘贴、CSV 或 TSV 导入。" : "这种文件不能用于所选的用途。");
    }
    throw error;
  }
}
