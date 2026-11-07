import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { contentImports, learningContents, mediaAssets, transcriptSegments, userVocabulary, vocabularyEntries } from "@/db/schema";
import { removeStored, storeAudio } from "@/lib/storage";
import { CEFR_LEVELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { difficultyOf } from "@/modules/materials/domain/text";
import { addEntriesForUser } from "@/modules/review/services/vocabulary";

import { IMPORT_LIMITS, analyzeText, parseSubtitles, parseText, parseWordList, type ParsedSegment, type ParsedWord, type TextAnalysis } from "../domain/parse";

/**
 * Content Importer (spec §5.14, §9.5): parse → draft with a preview →
 * learner confirms → published into the learning library. Imported material
 * belongs to its importer only and is for personal study.
 */

export const IMPORT_PURPOSES = ["reading", "listening", "vocabulary"] as const;
export type ImportPurpose = (typeof IMPORT_PURPOSES)[number];
export const SOURCE_KINDS = ["paste", "txt", "markdown", "srt", "vtt", "csv", "tsv"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const COPYRIGHT_STATUSES = ["own_work", "personal_use_only", "public_domain", "licensed"] as const;
export type CopyrightStatus = (typeof COPYRIGHT_STATUSES)[number];
export const COPYRIGHT_LABELS: Record<CopyrightStatus, string> = {
  own_work: "我自己写的",
  personal_use_only: "合法获得，仅供个人学习",
  public_domain: "公有领域",
  licensed: "有授权（如 CC 许可）",
};

export class ImportNotFoundError extends Error {}
export class ImportRejectedError extends Error {}

export type SegmentsPreview = { kind: "segments"; items: ParsedSegment[]; warnings: string[]; analysis: TextAnalysis; timed: boolean };
export type WordsPreview = { kind: "words"; items: (ParsedWord & { status: "new" | "already" })[]; warnings: string[] };
export type ImportPreview = SegmentsPreview | WordsPreview;

const ALLOWED: Record<ImportPurpose, SourceKind[]> = {
  reading: ["paste", "txt", "markdown", "srt", "vtt"],
  listening: ["paste", "txt", "markdown", "srt", "vtt"],
  vocabulary: ["paste", "csv", "tsv"],
};

async function knownWordTexts(db: DbExecutor, userId: string) {
  const rows = await db
    .select({ text: vocabularyEntries.text })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(eq(userVocabulary.userId, userId));
  return new Set(rows.map((r) => r.text.toLowerCase()));
}

export type CreateDraftInput = {
  purpose: ImportPurpose;
  sourceKind: SourceKind;
  title: string;
  fileName: string | null;
  text: string;
  copyrightStatus: CopyrightStatus;
  sourceNote: string | null;
  audio: { type: string; name: string; bytes: Uint8Array } | null;
};

/** Parse the upload and keep it as a draft (nothing is in the library yet). */
export async function createDraft(db: Database, userId: string, input: CreateDraftInput) {
  if (!ALLOWED[input.purpose].includes(input.sourceKind)) throw new ImportRejectedError(`${input.sourceKind} cannot be used for ${input.purpose}`);
  if (input.audio && input.purpose !== "listening") throw new ImportRejectedError("Audio only goes with listening material");
  if (input.audio && input.audio.bytes.byteLength > IMPORT_LIMITS.audioBytes) throw new ImportRejectedError("Audio file too large");

  let preview: ImportPreview;
  let suggestedLevel: string | null = null;
  if (input.purpose === "vocabulary") {
    // Pasted word lists: tab-separated if there are tabs, otherwise comma-separated.
    const kind = input.sourceKind === "tsv" || (input.sourceKind === "paste" && input.text.includes("\t")) ? "tsv" : "csv";
    const parsed = parseWordList(input.text, kind);
    const known = await knownWordTexts(db, userId);
    preview = { kind: "words", items: parsed.items.map((w) => ({ ...w, status: known.has(w.text.toLowerCase()) ? "already" : "new" })), warnings: parsed.warnings };
  } else {
    const timed = input.sourceKind === "srt" || input.sourceKind === "vtt";
    const parsed = timed ? parseSubtitles(input.text, input.sourceKind as "srt" | "vtt") : parseText(input.text, input.sourceKind as "paste" | "txt" | "markdown");
    const analysis = analyzeText(
      parsed.items.map((s) => s.en),
      await knownWordTexts(db, userId),
    );
    const warnings = [...parsed.warnings];
    if (input.audio && !timed) warnings.push("音频配的是没有时间轴的文本，没法逐句对齐，只能整段播放；需要逐句操作请导入 SRT / VTT 字幕。");
    if (input.purpose === "listening" && !input.audio) warnings.push("没有上传音频，听力会用浏览器朗读。");
    preview = { kind: "segments", items: parsed.items, warnings, analysis, timed };
    suggestedLevel = analysis.suggestedLevel;
  }

  return db.transaction(async (tx) => {
    let mediaAssetId: string | null = null;
    let stored: string | null = null;
    try {
      if (input.audio) {
        const file = await storeAudio(userId, input.audio);
        stored = file.relative;
        const [asset] = await tx
          .insert(mediaAssets)
          .values({ userId, kind: "audio", mimeType: input.audio.type, sizeBytes: file.size, storagePath: file.relative, originalName: input.audio.name.slice(0, 200), sha256: file.sha256 })
          .returning({ id: mediaAssets.id });
        mediaAssetId = asset!.id;
      }
      const [row] = await tx
        .insert(contentImports)
        .values({
          userId,
          sourceKind: input.sourceKind,
          purpose: input.purpose,
          title: input.title.trim().slice(0, 120) || "未命名材料",
          fileName: input.fileName?.slice(0, 200) ?? null,
          copyrightStatus: input.copyrightStatus,
          sourceNote: input.sourceNote?.trim().slice(0, 500) || null,
          status: "draft",
          parsed: preview,
          suggestedLevel,
          mediaAssetId,
        })
        .returning({ id: contentImports.id });
      return row!.id;
    } catch (error) {
      if (stored) await removeStored(stored);
      throw error;
    }
  });
}

async function getOwnedImport(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(contentImports)
    .where(and(eq(contentImports.id, id), eq(contentImports.userId, userId)));
  if (!row) throw new ImportNotFoundError(id);
  return row;
}

export async function getImport(db: DbExecutor, userId: string, id: string) {
  const row = await getOwnedImport(db, userId, id);
  const [asset] = row.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, row.mediaAssetId)) : [];
  return { ...row, parsed: row.parsed as ImportPreview, audio: asset ? { id: asset.id, name: asset.originalName, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType } : null };
}

export async function listImports(db: DbExecutor, userId: string) {
  return db
    .select({
      id: contentImports.id,
      purpose: contentImports.purpose,
      title: contentImports.title,
      sourceKind: contentImports.sourceKind,
      status: contentImports.status,
      copyrightStatus: contentImports.copyrightStatus,
      contentId: contentImports.contentId,
      createdAt: contentImports.createdAt,
      publishedAt: contentImports.publishedAt,
      count: sql<number>`jsonb_array_length(${contentImports.parsed}->'items')`,
    })
    .from(contentImports)
    .where(and(eq(contentImports.userId, userId), sql`${contentImports.status} <> 'discarded'`))
    .orderBy(desc(contentImports.createdAt));
}

/**
 * Confirm the preview. Text and subtitles become a reading or listening
 * material (with real timestamps and audio when given); a word list becomes
 * the learner's own vocabulary entries with review cards.
 */
export async function publishImport(db: Database, userId: string, id: string, options: { level: CefrLevel; title?: string }, now = new Date()) {
  const imp = await getImport(db, userId, id);
  if (imp.status !== "draft") throw new ImportRejectedError("Only drafts can be published");
  if (!CEFR_LEVELS.includes(options.level)) throw new ImportRejectedError("Unknown level");
  const title = options.title?.trim().slice(0, 120) || imp.title;

  if (imp.parsed.kind === "words") {
    const fresh = imp.parsed.items.filter((w) => w.status === "new");
    const known = await knownWordTexts(db, userId);
    const toAdd = fresh.filter((w) => !known.has(w.text.toLowerCase()));
    if (toAdd.length === 0 && imp.parsed.items.length === 0) throw new ImportRejectedError("Nothing to import");
    const ids: string[] = [];
    for (const w of toAdd) {
      const entryId = `user.${randomUUID()}`;
      ids.push(entryId);
      await db.insert(vocabularyEntries).values({
        id: entryId,
        unitId: null,
        key: w.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "word",
        text: w.text,
        partOfSpeech: w.pos ?? "",
        ipa: w.ipa,
        definitionZh: w.zh,
        exampleEn: w.exampleEn ?? "",
        exampleZh: w.exampleZh ?? "",
        cefrLevel: options.level,
        sourceType: "user_import",
        ownerUserId: userId,
      });
    }
    const added = await addEntriesForUser(db, userId, ids, `import:${imp.id}`, now);
    await db.update(contentImports).set({ status: "published", publishedAt: now, title }).where(eq(contentImports.id, imp.id));
    return { kind: "words" as const, added, skipped: imp.parsed.items.length - added, contentId: null };
  }

  const segments = imp.parsed.items;
  const analysis = imp.parsed.analysis;
  if (segments.length === 0) throw new ImportRejectedError("Nothing to import");
  const contentId = `imp-${randomUUID().slice(0, 12)}`;
  const lastEnd = segments.reduce((m, s) => Math.max(m, s.endMs ?? 0), 0);
  await db.transaction(async (tx) => {
    await tx.insert(learningContents).values({
      id: contentId,
      type: imp.purpose === "listening" ? "listening" : "reading",
      titleEn: title,
      titleZh: "我的材料",
      summaryZh: imp.sourceNote ?? (imp.fileName ? `导入自 ${imp.fileName}` : "粘贴导入的文本"),
      cefrLevel: options.level,
      topic: "我的材料",
      difficultyMetadata: { ...difficultyOf(segments.map((s) => s.en), []), analysis },
      sourceType: "user_import",
      sourceUrl: null,
      copyrightStatus: imp.copyrightStatus,
      reviewStatus: "unreviewed",
      status: "published",
      ownerUserId: userId,
      durationSeconds: lastEnd > 0 ? Math.ceil(lastEnd / 1000) : null,
      mediaAssetId: imp.mediaAssetId,
      content: { glossary: [], questions: [] },
      contentVersion: 1,
    });
    await tx.insert(transcriptSegments).values(
      segments.map((s, i) => ({
        contentId,
        sequence: i,
        startMs: s.startMs,
        endMs: s.endMs,
        speaker: s.speaker,
        textEn: s.en,
        textZh: s.zh,
        metadata: { paragraph: s.paragraph },
      })),
    );
    await tx.update(contentImports).set({ status: "published", publishedAt: now, contentId, title }).where(eq(contentImports.id, imp.id));
  });
  return { kind: "material" as const, added: segments.length, skipped: 0, contentId, type: imp.purpose === "listening" ? "listening" : "reading" };
}

async function dropMedia(db: DbExecutor, mediaAssetId: string | null) {
  if (!mediaAssetId) return;
  const [asset] = await db.delete(mediaAssets).where(eq(mediaAssets.id, mediaAssetId)).returning({ path: mediaAssets.storagePath });
  if (asset) await removeStored(asset.path);
}

/** Throw away a draft (and its uploaded audio). */
export async function discardImport(db: Database, userId: string, id: string) {
  const imp = await getOwnedImport(db, userId, id);
  if (imp.status !== "draft") throw new ImportRejectedError("Only drafts can be discarded");
  await db.update(contentImports).set({ status: "discarded", mediaAssetId: null }).where(eq(contentImports.id, imp.id));
  await dropMedia(db, imp.mediaAssetId);
}

/**
 * Delete a published imported material: its sentences, the learner's
 * interactions with it and its audio file. Built-in materials can't be deleted.
 */
export async function deleteImportedMaterial(db: Database, userId: string, importId: string) {
  const imp = await getOwnedImport(db, userId, importId);
  if (imp.status !== "published" || !imp.contentId) throw new ImportRejectedError("Not a published material");
  await db.delete(learningContents).where(and(eq(learningContents.id, imp.contentId), eq(learningContents.ownerUserId, userId)));
  await db.update(contentImports).set({ status: "discarded", contentId: null, mediaAssetId: null }).where(eq(contentImports.id, imp.id));
  await dropMedia(db, imp.mediaAssetId);
}

/** An audio file the learner may play (their own upload). */
export async function getOwnedMedia(db: DbExecutor, userId: string, mediaId: string) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.userId, userId)));
  return asset ?? null;
}

