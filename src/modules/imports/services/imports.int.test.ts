import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { contentImports, learningContents, mediaAssets, reviewCards, transcriptSegments, userVocabulary, users, vocabularyEntries } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { InvalidAudioError, resolveStored } from "@/lib/storage";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { collectWord, getMaterialForReader, listMaterials, lookupWord } from "@/modules/materials/services/materials";
import { addWordsFromLesson } from "@/modules/review/services/vocabulary";

import { ImportNotFoundError, ImportRejectedError, createDraft, deleteImportedMaterial, discardImport, getImport, getOwnedMedia, listImports, publishImport, type CreateDraftInput } from "./imports";

// Uploaded files go to a throwaway directory (STORAGE_ROOT is read lazily by getEnv()).
const storage = mkdtempSync(path.join(tmpdir(), "lb-import-"));
process.env.STORAGE_ROOT = storage;

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
let userA: string;
let userB: string;

/** A valid, tiny WAV file (header + a little silence). */
function wav(): Uint8Array {
  const data = 800;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return new Uint8Array(b);
}

const base = (over: Partial<CreateDraftInput>): CreateDraftInput => ({
  purpose: "reading",
  sourceKind: "paste",
  title: "My text",
  fileName: null,
  text: "",
  copyrightStatus: "own_work",
  sourceNote: null,
  audio: null,
  ...over,
});

const SRT = "1\n00:00:00,500 --> 00:00:02,000\nHello, Anna.\n\n2\n00:00:02,500 --> 00:00:04,000\nHow are you today?\n";

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  await db.delete(learningContents).where(eq(learningContents.sourceType, "user_import"));
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(async () => {
  await client.end();
  rmSync(storage, { recursive: true, force: true });
});

describe("text import", () => {
  it("keeps a draft with a preview, then publishes a private reading material", async () => {
    const id = await createDraft(db, userA, base({ sourceKind: "markdown", fileName: "note.md", text: "# My Weekend\n\nI went to the park. It was sunny!\n\nThen I read a book." }));
    const draft = await getImport(db, userA, id);
    expect(draft).toMatchObject({ status: "draft", suggestedLevel: "a1" });
    if (draft.parsed.kind !== "segments") throw new Error("expected segments");
    expect(draft.parsed.items.map((s) => s.en)).toEqual(["My Weekend", "I went to the park.", "It was sunny!", "Then I read a book."]);
    expect(draft.parsed.analysis).toMatchObject({ wordCount: 15, sentenceCount: 4 });
    // Not in the library yet.
    expect((await listMaterials(db, userA, "reading")).materials.some((m) => m.imported)).toBe(false);

    const result = await publishImport(db, userA, id, { level: "a2", title: "Weekend" });
    expect(result).toMatchObject({ kind: "material", added: 4, type: "reading" });
    const material = await getMaterialForReader(db, userA, result.contentId!);
    expect(material).toMatchObject({ imported: true, titleEn: "Weekend", levelLabel: "A2", media: null, copyrightStatus: "own_work" });
    expect(material.questions).toEqual([]);
    expect((await listMaterials(db, userA, "reading")).materials.find((m) => m.id === result.contentId)).toMatchObject({ imported: true });
    expect((await listMaterials(db, userB, "reading")).materials.some((m) => m.id === result.contentId)).toBe(false);
    await expect(publishImport(db, userA, id, { level: "a2" })).rejects.toBeInstanceOf(ImportRejectedError);
    expect((await listImports(db, userA))[0]).toMatchObject({ status: "published", count: 4 });
  });

  it("refuses wrong combinations and other learners' imports", async () => {
    await expect(createDraft(db, userA, base({ purpose: "vocabulary", sourceKind: "srt", text: SRT }))).rejects.toBeInstanceOf(ImportRejectedError);
    await expect(createDraft(db, userA, base({ purpose: "reading", text: "Hi.", audio: { type: "audio/wav", name: "a.wav", bytes: wav() } }))).rejects.toBeInstanceOf(ImportRejectedError);
    const id = await createDraft(db, userA, base({ text: "Hello there." }));
    await expect(getImport(db, userB, id)).rejects.toBeInstanceOf(ImportNotFoundError);
    await expect(publishImport(db, userB, id, { level: "a1" })).rejects.toBeInstanceOf(ImportNotFoundError);
    await discardImport(db, userA, id);
    expect(await listImports(db, userA)).toEqual([]);
  });
});

describe("subtitles and audio", () => {
  it("stores audio, publishes timed listening material and deletes everything on request", async () => {
    const id = await createDraft(db, userA, base({ purpose: "listening", sourceKind: "srt", fileName: "talk.srt", text: SRT, audio: { type: "audio/wav", name: "talk.wav", bytes: wav() } }));
    const draft = await getImport(db, userA, id);
    expect(draft.audio).toMatchObject({ name: "talk.wav", mimeType: "audio/wav" });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.userId, userA));
    expect(readFileSync(resolveStored(asset!.storagePath)).subarray(0, 4).toString()).toBe("RIFF");
    expect(resolveStored(asset!.storagePath).startsWith(storage)).toBe(true);
    expect(await getOwnedMedia(db, userB, asset!.id)).toBeNull();

    const result = await publishImport(db, userA, id, { level: "a1" });
    const material = await getMaterialForReader(db, userA, result.contentId!);
    expect(material).toMatchObject({ type: "listening", media: { url: `/api/media/${asset!.id}` } });
    expect(material.segments.map((s) => [s.startMs, s.endMs, s.en])).toEqual([
      [500, 2000, "Hello, Anna."],
      [2500, 4000, "How are you today?"],
    ]);
    const [content] = await db.select().from(learningContents).where(eq(learningContents.id, result.contentId!));
    expect(content!.durationSeconds).toBe(4);

    await deleteImportedMaterial(db, userA, id);
    expect(await db.select().from(learningContents).where(eq(learningContents.id, result.contentId!))).toHaveLength(0);
    expect(await db.select().from(transcriptSegments).where(eq(transcriptSegments.contentId, result.contentId!))).toHaveLength(0);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.userId, userA))).toHaveLength(0);
    expect(() => readFileSync(resolveStored(asset!.storagePath))).toThrow();
  });

  it("rejects files that only pretend to be audio, and keeps nothing behind", async () => {
    const fake = new TextEncoder().encode("<html>not audio</html>");
    await expect(createDraft(db, userA, base({ purpose: "listening", sourceKind: "srt", text: SRT, audio: { type: "audio/mpeg", name: "x.mp3", bytes: fake } }))).rejects.toBeInstanceOf(InvalidAudioError);
    expect(await db.select().from(contentImports).where(eq(contentImports.userId, userA))).toHaveLength(0);
    expect(await db.select().from(mediaAssets)).toHaveLength(0);
  });
});

describe("word list import", () => {
  it("adds new words with review cards, skips words already learned, and makes them lookup-able", async () => {
    await addWordsFromLesson(db, userA, "pre-a1-u03-hello-l1", ["hello"]);
    const id = await createDraft(db, userA, base({ purpose: "vocabulary", sourceKind: "csv", fileName: "words.csv", text: "word,meaning,example\nhello,你好,\nfriend,朋友（我自己的释义）,She is my friend.\nborrow,借入,Can I borrow it?" }));
    const draft = await getImport(db, userA, id);
    if (draft.parsed.kind !== "words") throw new Error("expected words");
    expect(draft.parsed.items.map((w) => [w.text, w.status])).toEqual([
      ["hello", "already"],
      ["friend", "new"],
      ["borrow", "new"],
    ]);
    expect(await publishImport(db, userA, id, { level: "a1" })).toMatchObject({ kind: "words", added: 2, skipped: 1 });

    const mine = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.ownerUserId, userA));
    expect(mine.map((e) => e.text).sort()).toEqual(["borrow", "friend"]);
    const vocab = await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userA));
    expect(vocab.filter((v) => v.addedFrom === `import:${id}`)).toHaveLength(2);
    expect(await db.select().from(reviewCards).where(eq(reviewCards.entryId, mine[0]!.id))).toHaveLength(2);

    // Lookup in an imported text finds the learner's own word list (and only theirs).
    const textId = await createDraft(db, userA, base({ text: "I want to borrow a pen." }));
    const { contentId } = await publishImport(db, userA, textId, { level: "a1" });
    const found = await lookupWord(db, userA, contentId!, "borrow", null, 0);
    expect(found).toMatchObject({ source: "course", zh: "借入", collected: true });
    expect(await collectWord(db, userA, contentId!, found.entryId!)).toEqual({ added: false });
    expect(await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.ownerUserId, userB))).toHaveLength(0);
  });
});
