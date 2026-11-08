import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { contentInteractions, learningContents, transcriptSegments, userContentState, userVocabulary, vocabularyEntries } from "@/db/schema";
import { getCurrentEstimates } from "@/modules/assessment/services/assessment";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, isCefrLevel, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { refreshPracticeEstimate } from "@/modules/assessment/services/practice-estimates";
import { recordError } from "@/modules/errors/services/errors";
import { addEntriesForUser } from "@/modules/review/services/vocabulary";

import type { MaterialQuestion, MaterialType } from "../content";
import { checkDictation, tokenize, words, type DictationWord, type GlossaryEntry, type Token } from "../domain/text";

/**
 * Reading Room and Listening Studio (spec §5.6, §5.7). Materials are visible
 * when built in or imported by this learner; every learner-specific query is
 * scoped by userId. Answer keys stay on the server.
 */

export class MaterialNotFoundError extends Error {}

type StoredContent = { glossary: GlossaryEntry[]; questions: MaterialQuestion[] };

const visibleTo = (userId: string) =>
  and(
    eq(learningContents.status, "published"),
    or(isNull(learningContents.ownerUserId), eq(learningContents.ownerUserId, userId)),
  );

async function getVisibleMaterial(db: DbExecutor, userId: string, contentId: string) {
  const [row] = await db
    .select()
    .from(learningContents)
    .where(and(eq(learningContents.id, contentId), visibleTo(userId)))
    .limit(1);
  if (!row) throw new MaterialNotFoundError(contentId);
  return { ...row, stored: row.content as StoredContent };
}

// ------------------------------------------------------------- level fit ----

export type LevelFit = "easier" | "right" | "stretch" | "hard";
export const LEVEL_FIT_LABELS: Record<LevelFit, string> = {
  easier: "偏简单",
  right: "适合你",
  stretch: "稍有挑战",
  hard: "比较难",
};

/** The level used to judge materials: the skill's estimate, else the vocabulary/grammar placement, else Pre-A1. */
export async function learnerInputLevel(db: DbExecutor, userId: string, type: MaterialType): Promise<{ level: CefrLevel; basis: string }> {
  const estimates = await getCurrentEstimates(db, userId);
  const skill = estimates.find((e) => e.skill === type);
  if (skill && isCefrLevel(skill.level)) return { level: skill.level, basis: type === "reading" ? "阅读估计" : "听力估计" };
  const base = estimates.filter((e) => (e.skill === "vocabulary" || e.skill === "grammar") && isCefrLevel(e.level));
  if (base.length > 0) {
    const idx = Math.min(...base.map((e) => CEFR_LEVELS.indexOf(e.level as CefrLevel)));
    return { level: CEFR_LEVELS[idx]!, basis: "诊断估计" };
  }
  return { level: "pre_a1", basis: "还没有诊断，按入门水平" };
}

export function levelFit(material: string, learner: CefrLevel): LevelFit {
  const diff = CEFR_LEVELS.indexOf(material as CefrLevel) - CEFR_LEVELS.indexOf(learner);
  return diff < 0 ? "easier" : diff === 0 ? "right" : diff === 1 ? "stretch" : "hard";
}

/** Glossary words the learner already has (same entry, or the same word from a course). */
async function knownGlossaryTexts(db: DbExecutor, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ text: vocabularyEntries.text })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(eq(userVocabulary.userId, userId));
  return new Set(rows.map((r) => r.text.toLowerCase()));
}

// ----------------------------------------------------------------- lists ----

export type MaterialSummary = {
  id: string;
  type: MaterialType;
  titleEn: string;
  titleZh: string;
  summaryZh: string;
  level: string;
  levelLabel: string;
  topic: string | null;
  wordCount: number;
  sentenceCount: number;
  newWords: number;
  glossaryCount: number;
  fit: LevelFit;
  completed: boolean;
  favorite: boolean;
  imported: boolean;
};

export async function listMaterials(db: DbExecutor, userId: string, type: MaterialType) {
  const [rows, known, learner] = await Promise.all([
    db
      .select({ content: learningContents, state: userContentState })
      .from(learningContents)
      .leftJoin(userContentState, and(eq(userContentState.contentId, learningContents.id), eq(userContentState.userId, userId)))
      .where(and(eq(learningContents.type, type), visibleTo(userId)))
      .orderBy(asc(learningContents.cefrLevel), asc(learningContents.id)),
    knownGlossaryTexts(db, userId),
    learnerInputLevel(db, userId, type),
  ]);
  const order = (l: string) => CEFR_LEVELS.indexOf(l as CefrLevel);
  const materials = rows
    .map(({ content: c, state }): MaterialSummary => {
      const stored = c.content as StoredContent;
      const meta = c.difficultyMetadata as { wordCount: number; sentenceCount: number };
      return {
        id: c.id,
        type: c.type as MaterialType,
        titleEn: c.titleEn,
        titleZh: c.titleZh,
        summaryZh: c.summaryZh,
        level: c.cefrLevel,
        levelLabel: isCefrLevel(c.cefrLevel) ? CEFR_LEVEL_LABELS[c.cefrLevel] : c.cefrLevel,
        topic: c.topic,
        wordCount: meta.wordCount,
        sentenceCount: meta.sentenceCount,
        glossaryCount: stored.glossary.length,
        newWords: stored.glossary.filter((g) => !known.has(g.text.toLowerCase())).length,
        fit: levelFit(c.cefrLevel, learner.level),
        completed: Boolean(state?.completedAt),
        favorite: Boolean(state?.favorite),
        imported: c.ownerUserId !== null,
      };
    })
    .sort((a, b) => order(a.level) - order(b.level) || a.id.localeCompare(b.id));
  return { materials, learner: { ...learner, label: CEFR_LEVEL_LABELS[learner.level] } };
}

// ---------------------------------------------------------------- reader ----

export type ClientQuestion = Omit<MaterialQuestion, "answer" | "explanation_zh"> & {
  answered: { choice: number; isCorrect: boolean; correctAnswer: string; explanationZh: string } | null;
};

export type ClientSegment = {
  /** Segment id (generated speech is fetched per sentence). */
  id: string;
  sequence: number;
  speaker: string | null;
  /** Real timestamps (imported subtitles) or null. */
  startMs: number | null;
  endMs: number | null;
  en: string;
  zh: string | null;
  tokens: Token[];
  /** One key word to listen for (listening practice), if the sentence has a glossary word. */
  keyword: { before: string; after: string; length: number; glossKey: string } | null;
};

export type ReaderMaterial = {
  id: string;
  type: MaterialType;
  titleEn: string;
  titleZh: string;
  summaryZh: string;
  levelLabel: string;
  fit: LevelFit;
  learnerLevelLabel: string;
  titleTokens: Token[];
  segments: ClientSegment[];
  glossary: (GlossaryEntry & { collected: boolean })[];
  questions: ClientQuestion[];
  state: { favorite: boolean; note: string; savedSegments: number[]; completed: boolean };
  newWords: number;
  imported: boolean;
  sourceType: string;
  copyrightStatus: string;
  /** The learner's uploaded audio, if any. */
  media: { url: string } | null;
};

function keywordFor(text: string, tokens: Token[], glossKeySet: Set<string>): ClientSegment["keyword"] {
  let offset = 0;
  for (const t of tokens) {
    if (t.kind === "word" && t.gloss && glossKeySet.has(t.gloss) && words(t.text).length === 1) {
      return { before: text.slice(0, offset), after: text.slice(offset + t.text.length), length: t.text.length, glossKey: t.gloss };
    }
    offset += t.text.length;
  }
  return null;
}

export async function getMaterialForReader(db: DbExecutor, userId: string, contentId: string): Promise<ReaderMaterial> {
  const m = await getVisibleMaterial(db, userId, contentId);
  const [segments, [state], known, learner, answers] = await Promise.all([
    db.select().from(transcriptSegments).where(eq(transcriptSegments.contentId, contentId)).orderBy(asc(transcriptSegments.sequence)),
    db
      .select()
      .from(userContentState)
      .where(and(eq(userContentState.userId, userId), eq(userContentState.contentId, contentId))),
    knownGlossaryTexts(db, userId),
    learnerInputLevel(db, userId, m.type as MaterialType),
    db
      .selectDistinctOn([sql`${contentInteractions.payload}->>'questionId'`], {
        questionId: sql<string>`${contentInteractions.payload}->>'questionId'`,
        choice: sql<number>`(${contentInteractions.payload}->>'choice')::int`,
        isCorrect: contentInteractions.isCorrect,
      })
      .from(contentInteractions)
      .where(and(eq(contentInteractions.userId, userId), eq(contentInteractions.contentId, contentId), eq(contentInteractions.kind, "question")))
      .orderBy(sql`${contentInteractions.payload}->>'questionId'`, desc(contentInteractions.createdAt)),
  ]);
  const { glossary, questions } = m.stored;
  const singleWordKeys = new Set(glossary.map((g) => g.key));

  return {
    id: m.id,
    type: m.type as MaterialType,
    titleEn: m.titleEn,
    titleZh: m.titleZh,
    summaryZh: m.summaryZh,
    levelLabel: isCefrLevel(m.cefrLevel) ? CEFR_LEVEL_LABELS[m.cefrLevel] : m.cefrLevel,
    fit: levelFit(m.cefrLevel, learner.level),
    learnerLevelLabel: CEFR_LEVEL_LABELS[learner.level],
    titleTokens: tokenize(m.titleEn, glossary),
    segments: segments.map((s) => {
      const tokens = tokenize(s.textEn, glossary);
      return {
        id: s.id,
        sequence: s.sequence,
        speaker: s.speaker,
        startMs: s.startMs,
        endMs: s.endMs,
        en: s.textEn,
        zh: s.textZh,
        tokens,
        keyword: keywordFor(s.textEn, tokens, singleWordKeys),
      };
    }),
    glossary: glossary.map((g) => ({ ...g, collected: known.has(g.text.toLowerCase()) })),
    questions: questions.map(({ answer, explanation_zh, ...q }) => {
      const a = answers.find((x) => x.questionId === q.id);
      return {
        ...q,
        answered: a ? { choice: a.choice, isCorrect: Boolean(a.isCorrect), correctAnswer: q.options[answer]!, explanationZh: explanation_zh } : null,
      };
    }),
    state: {
      favorite: state?.favorite ?? false,
      note: state?.note ?? "",
      savedSegments: state?.savedSegments ?? [],
      completed: Boolean(state?.completedAt),
    },
    newWords: glossary.filter((g) => !known.has(g.text.toLowerCase())).length,
    imported: m.ownerUserId !== null,
    sourceType: m.sourceType,
    copyrightStatus: m.copyrightStatus,
    media: m.mediaAssetId ? { url: `/api/media/${m.mediaAssetId}` } : null,
  };
}

// ---------------------------------------------------------------- lookup ----

export type LookupResult = {
  text: string;
  ipa: string | null;
  zh: string;
  pos: string | null;
  note: string | null;
  exampleEn: string | null;
  exampleZh: string | null;
  /** What "加入词汇库" would add; null if there is nothing to add. */
  entryId: string | null;
  collected: boolean;
  source: "glossary" | "course" | "none";
};

/**
 * Look a word up: the material's glossary first, then words taught in the
 * courses. Anything else has no definition yet (AI definitions come in Phase 3).
 * Every lookup is logged (spec §2.5: frequent lookups signal difficulty).
 */
export async function lookupWord(db: DbExecutor, userId: string, contentId: string, word: string, glossKey: string | null, segmentSeq: number | null): Promise<LookupResult> {
  const m = await getVisibleMaterial(db, userId, contentId);
  const known = await knownGlossaryTexts(db, userId);
  let result: LookupResult;
  const g = glossKey ? m.stored.glossary.find((x) => x.key === glossKey) : undefined;
  if (g) {
    const [entry] = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.id, `${m.id}.${g.key}`));
    result = {
      text: g.text,
      ipa: g.ipa ?? null,
      zh: g.zh,
      pos: g.pos,
      note: g.note_zh ?? null,
      exampleEn: entry?.exampleEn ?? null,
      exampleZh: entry?.exampleZh ?? null,
      entryId: entry ? entry.id : null,
      collected: known.has(g.text.toLowerCase()),
      source: "glossary",
    };
  } else {
    const [entry] = await db
      .select()
      .from(vocabularyEntries)
      .where(
        and(
          sql`lower(${vocabularyEntries.text}) = ${word.toLowerCase()}`,
          // Course words, or words this learner imported themselves.
          or(sql`${vocabularyEntries.unitId} is not null`, eq(vocabularyEntries.ownerUserId, userId)),
        ),
      )
      .orderBy(sql`${vocabularyEntries.ownerUserId} is not null`, asc(vocabularyEntries.id))
      .limit(1);
    result = entry
      ? {
          text: entry.text,
          ipa: entry.ipa,
          zh: entry.definitionZh,
          pos: entry.partOfSpeech,
          note: null,
          exampleEn: entry.exampleEn,
          exampleZh: entry.exampleZh,
          entryId: entry.id,
          collected: known.has(entry.text.toLowerCase()),
          source: "course",
        }
      : { text: word, ipa: null, zh: "", pos: null, note: null, exampleEn: null, exampleZh: null, entryId: null, collected: false, source: "none" };
  }
  await db.insert(contentInteractions).values({
    userId,
    contentId,
    kind: "lookup",
    segmentSeq,
    payload: { word: word.slice(0, 80), glossKey, found: result.source !== "none" },
  });
  return result;
}

/**
 * Put a looked-up word into the vocabulary lab with review cards. If the
 * learner already has the same word (e.g. from a lesson), nothing is added.
 */
export async function collectWord(db: Database, userId: string, contentId: string, entryId: string): Promise<{ added: boolean }> {
  const m = await getVisibleMaterial(db, userId, contentId);
  const [entry] = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.id, entryId));
  // Only this material's glossary words or course words can be collected from here.
  if (!entry || !(entry.id.startsWith(`${m.id}.`) || entry.unitId !== null || entry.ownerUserId === userId)) throw new MaterialNotFoundError(entryId);
  const known = await knownGlossaryTexts(db, userId);
  if (known.has(entry.text.toLowerCase())) return { added: false };
  const added = await addEntriesForUser(db, userId, [entry.id], `material:${m.id}`);
  if (added > 0) await db.insert(contentInteractions).values({ userId, contentId, kind: "collect", payload: { entryId } });
  return { added: added > 0 };
}

// ------------------------------------------------------------- practice ----

export type QuestionResult = { isCorrect: boolean; correctAnswer: string; explanationZh: string; segment: number | null; duplicate: boolean };

export async function answerQuestion(
  db: Database,
  userId: string,
  input: { contentId: string; questionId: string; choice: number; clientRequestId: string; durationMs?: number },
): Promise<QuestionResult> {
  const m = await getVisibleMaterial(db, userId, input.contentId);
  const q = m.stored.questions.find((x) => x.id === input.questionId);
  if (!q) throw new MaterialNotFoundError(`${input.contentId}.${input.questionId}`);
  const base = { correctAnswer: q.options[q.answer]!, explanationZh: q.explanation_zh, segment: q.segment ?? null };
  const [existing] = await db
    .select({ isCorrect: contentInteractions.isCorrect })
    .from(contentInteractions)
    .where(and(eq(contentInteractions.clientRequestId, input.clientRequestId), eq(contentInteractions.userId, userId)));
  if (existing) return { ...base, isCorrect: Boolean(existing.isCorrect), duplicate: true };
  const isCorrect = input.choice === q.answer;
  await db.transaction(async (tx) => {
    await tx.insert(contentInteractions).values({
      userId,
      contentId: m.id,
      kind: "question",
      segmentSeq: q.segment ?? null,
      payload: { questionId: q.id, choice: input.choice },
      isCorrect,
      durationMs: input.durationMs ?? null,
      clientRequestId: input.clientRequestId,
    });
    if (!isCorrect) {
      await recordError(tx, userId, {
        category: "comprehension",
        pointType: "material",
        pointId: m.id,
        title: `${m.titleEn}（${m.titleZh}）`,
        source: m.type === "listening" ? "listening" : "reading",
        sourceRef: `${m.id}#${q.id}`,
        wrong: `${q.prompt_zh} → ${q.options[input.choice] ?? "?"}`,
        correct: base.correctAnswer,
      });
    }
  });
  await refreshPracticeEstimate(db, userId, m.type as MaterialType);
  return { ...base, isCorrect, duplicate: false };
}

export type DictationResult = { isCorrect: boolean; words: DictationWord[]; extra: string[]; expected: string };

/** Sentence dictation or key-word listening for one sentence. */
export async function checkDictationAttempt(
  db: Database,
  userId: string,
  input: { contentId: string; segmentSeq: number; mode: "sentence" | "keyword"; text: string; clientRequestId: string; durationMs?: number },
): Promise<DictationResult> {
  const m = await getVisibleMaterial(db, userId, input.contentId);
  const [segment] = await db
    .select()
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.contentId, m.id), eq(transcriptSegments.sequence, input.segmentSeq)));
  if (!segment) throw new MaterialNotFoundError(`${m.id}#${input.segmentSeq}`);
  let expected = segment.textEn;
  if (input.mode === "keyword") {
    const tokens = tokenize(segment.textEn, m.stored.glossary);
    const kw = keywordFor(segment.textEn, tokens, new Set(m.stored.glossary.map((g) => g.key)));
    if (!kw) throw new MaterialNotFoundError(`${m.id}#${input.segmentSeq} has no key word`);
    expected = segment.textEn.slice(kw.before.length, kw.before.length + kw.length);
  }
  const result = checkDictation(expected, input.text);
  const [existing] = await db
    .select({ id: contentInteractions.id })
    .from(contentInteractions)
    .where(and(eq(contentInteractions.clientRequestId, input.clientRequestId), eq(contentInteractions.userId, userId)));
  if (!existing) {
    if (!result.isCorrect) {
      // Dictation errors are listening errors for the material; a missed key word is linked to that word.
      const kw = input.mode === "keyword" ? m.stored.glossary.find((g) => expected.toLowerCase() === g.text.toLowerCase() || g.forms?.some((f) => f.toLowerCase() === expected.toLowerCase())) : undefined;
      await recordError(db, userId, {
        category: "listening",
        pointType: kw ? "vocabulary" : "material",
        pointId: kw ? `${m.id}.${kw.key}` : m.id,
        title: kw ? kw.text : `${m.titleEn}（${m.titleZh}）`,
        source: "listening",
        sourceRef: `${m.id}#${input.segmentSeq}`,
        wrong: input.text,
        correct: expected,
      });
    }
    await db.insert(contentInteractions).values({
      userId,
      contentId: m.id,
      kind: input.mode === "keyword" ? "keyword" : "dictation",
      segmentSeq: input.segmentSeq,
      payload: { text: input.text.slice(0, 500) },
      isCorrect: result.isCorrect,
      durationMs: input.durationMs ?? null,
      clientRequestId: input.clientRequestId,
    });
  }
  return { ...result, expected };
}

/** Light-weight events: open, reveal transcript, play / replay a sentence, study time. */
export const SIMPLE_EVENTS = ["open", "reveal_transcript", "play", "replay", "assist_mode", "time"] as const;
export type SimpleEvent = (typeof SIMPLE_EVENTS)[number];
/** One "time" record covers at most this much study (idle time is not study). */
export const MAX_TIME_SLICE_MS = 60_000;

export async function recordEvent(
  db: DbExecutor,
  userId: string,
  input: { contentId: string; kind: SimpleEvent; segmentSeq?: number; durationMs?: number; detail?: string },
) {
  await getVisibleMaterial(db, userId, input.contentId);
  await db.insert(contentInteractions).values({
    userId,
    contentId: input.contentId,
    kind: input.kind,
    segmentSeq: input.segmentSeq ?? null,
    payload: input.detail ? { detail: input.detail.slice(0, 40) } : null,
    durationMs: input.kind === "time" ? Math.min(MAX_TIME_SLICE_MS, Math.max(0, input.durationMs ?? 0)) : null,
  });
}

// ----------------------------------------------------------------- state ----

async function upsertState(db: DbExecutor, userId: string, contentId: string, set: Partial<typeof userContentState.$inferInsert>) {
  await getVisibleMaterial(db, userId, contentId);
  await db
    .insert(userContentState)
    .values({ userId, contentId, ...set })
    .onConflictDoUpdate({ target: [userContentState.userId, userContentState.contentId], set });
}

export const setFavorite = (db: DbExecutor, userId: string, contentId: string, favorite: boolean) => upsertState(db, userId, contentId, { favorite });

export const saveNote = (db: DbExecutor, userId: string, contentId: string, note: string) =>
  upsertState(db, userId, contentId, { note: note.trim() === "" ? null : note.trim().slice(0, 4000) });

export async function toggleSavedSegment(db: DbExecutor, userId: string, contentId: string, segmentSeq: number) {
  const [state] = await db
    .select({ saved: userContentState.savedSegments })
    .from(userContentState)
    .where(and(eq(userContentState.userId, userId), eq(userContentState.contentId, contentId)));
  const saved = new Set(state?.saved ?? []);
  if (saved.has(segmentSeq)) saved.delete(segmentSeq);
  else saved.add(segmentSeq);
  const savedSegments = [...saved].sort((a, b) => a - b);
  await upsertState(db, userId, contentId, { savedSegments });
  return savedSegments;
}

export async function markCompleted(db: DbExecutor, userId: string, contentId: string, now = new Date()) {
  await upsertState(db, userId, contentId, { completedAt: now });
  await db.insert(contentInteractions).values({ userId, contentId, kind: "complete", createdAt: now });
}

/** For the Today plan: an unfinished material near the learner's level. */
export type InputPickOptions = {
  /** Used when reading and listening are at the same level: alternate by day. */
  fallbackType: MaterialType;
  /** Can-do ids the learner already has passing evidence for. */
  passedCanDo?: ReadonlySet<string>;
  /** Can-do statements a material may give evidence for (material id → ids) and their Chinese text. */
  materialCanDo?: ReadonlyMap<string, string[]>;
  canDoZh?: ReadonlyMap<string, string>;
};

/**
 * Today's reading or listening (spec §4.3, Phase 5.3): the weaker of the two
 * skills first, at a comfortable level, preferring a text that can give the
 * first evidence for a can-do statement. Returns the reasons it was chosen.
 */
export async function pickInputMaterial(db: DbExecutor, userId: string, options: InputPickOptions) {
  const candidates = await db
    .select({ id: learningContents.id, type: learningContents.type, level: learningContents.cefrLevel, titleEn: learningContents.titleEn, titleZh: learningContents.titleZh, content: learningContents.content })
    .from(learningContents)
    .leftJoin(userContentState, and(eq(userContentState.contentId, learningContents.id), eq(userContentState.userId, userId)))
    .where(and(visibleTo(userId), isNull(userContentState.completedAt)))
    .orderBy(asc(learningContents.id));
  if (candidates.length === 0) return null;
  const known = await knownGlossaryTexts(db, userId);
  const levels = { reading: await learnerInputLevel(db, userId, "reading"), listening: await learnerInputLevel(db, userId, "listening") };
  const gap = CEFR_LEVELS.indexOf(levels.reading.level) - CEFR_LEVELS.indexOf(levels.listening.level);
  // Skill gap: the lower estimate gets the input today; equal levels alternate by day.
  const preferType: MaterialType = gap > 0 ? "listening" : gap < 0 ? "reading" : options.fallbackType;
  const firstEvidence = (id: string) => (options.materialCanDo?.get(id) ?? []).find((c) => !options.passedCanDo?.has(c));
  const score = (c: (typeof candidates)[number]) => {
    const fit = levelFit(c.level, levels[c.type as MaterialType].level);
    const fitScore = { right: 0, easier: 1, stretch: 2, hard: 9 }[fit];
    return fitScore * 10 + (c.type === preferType ? 0 : 4) + (firstEvidence(c.id) ? 0 : 2);
  };
  const best = [...candidates].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0]!;
  if (score(best) >= 90) return null;
  const glossary = (best.content as StoredContent).glossary;
  const type = best.type as MaterialType;
  const reasons: string[] = [];
  if (gap !== 0 && type === preferType) {
    const label = (t: MaterialType) => `${t === "reading" ? "阅读" : "听力"}（${CEFR_LEVEL_LABELS[levels[t].level]}）`;
    reasons.push(`你的${label(type)}低于${label(type === "reading" ? "listening" : "reading")}，今天先补这一项`);
  }
  const canDo = firstEvidence(best.id);
  if (canDo && options.canDoZh?.get(canDo)) reasons.push(`做完理解题能为“${options.canDoZh.get(canDo)}”提供第一份证据`);
  return {
    id: best.id,
    type,
    titleEn: best.titleEn,
    titleZh: best.titleZh,
    levelLabel: isCefrLevel(best.level) ? CEFR_LEVEL_LABELS[best.level] : best.level,
    newWords: glossary.filter((g) => !known.has(g.text.toLowerCase())).length,
    fit: levelFit(best.level, levels[type].level),
    reasons,
  };
}


/** One sentence of a material the learner can see (built-in or their own), for speech synthesis. */
export async function getSegmentText(db: DbExecutor, userId: string, segmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ text: transcriptSegments.textEn })
    .from(transcriptSegments)
    .innerJoin(learningContents, eq(learningContents.id, transcriptSegments.contentId))
    .where(and(eq(transcriptSegments.id, segmentId), or(isNull(learningContents.ownerUserId), eq(learningContents.ownerUserId, userId))));
  return row?.text ?? null;
}
