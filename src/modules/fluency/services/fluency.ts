import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { fluencyAttempts, learningContents, transcriptSegments, userContentState, type FluencyRound } from "@/db/schema";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import type { MaterialType } from "@/modules/materials/content";
import { getVisibleMaterial, learnerInputLevel, levelFit, MaterialNotFoundError, type StoredContent } from "@/modules/materials/services/materials";

import {
  MAX_DURATION_MS,
  MAX_ROUND_MS,
  MAX_WPM,
  MIN_ROUND_MS,
  ROUNDS,
  retellCues,
  retellLimitsMs,
  roundGain,
  speedCounts,
  suggestKind,
  weeklyFluencyTarget,
  wordCountOf,
  wordsPerMinute,
  type FluencyKind,
} from "../domain/fluency";

/**
 * Fluency practice (spec §2.2). Texts come from the reading / listening
 * library and must be easy for the learner: already finished, or below their
 * level. Answer keys and word counts stay on the server; the speed is worked
 * out here, never trusted from the browser.
 */

export class FluencyInputError extends Error {}
export { MaterialNotFoundError };

const levelLabel = (level: string) => (isCefrLevel(level) ? CEFR_LEVEL_LABELS[level] : level);

// ------------------------------------------------------------------ texts ----

export type FluencyText = {
  id: string;
  type: MaterialType;
  titleEn: string;
  titleZh: string;
  level: string;
  levelLabel: string;
  wordCount: number;
  /** Why it suits fluency practice: finished before, or below the learner's level. */
  why: "completed" | "easier";
  questionCount: number;
  lastPractisedAt: Date | null;
  practiceCount: number;
};

/** Texts that are easy enough for fluency work, least recently practised first. */
export async function listFluencyTexts(db: DbExecutor, userId: string): Promise<FluencyText[]> {
  const [rows, levels, used] = await Promise.all([
    db
      .select({
        id: learningContents.id,
        type: learningContents.type,
        titleEn: learningContents.titleEn,
        titleZh: learningContents.titleZh,
        level: learningContents.cefrLevel,
        meta: learningContents.difficultyMetadata,
        content: learningContents.content,
        completedAt: userContentState.completedAt,
      })
      .from(learningContents)
      .leftJoin(userContentState, and(eq(userContentState.contentId, learningContents.id), eq(userContentState.userId, userId)))
      .where(and(eq(learningContents.status, "published"), or(isNull(learningContents.ownerUserId), eq(learningContents.ownerUserId, userId))))
      .orderBy(asc(learningContents.id)),
    Promise.all([learnerInputLevel(db, userId, "reading"), learnerInputLevel(db, userId, "listening")]),
    db
      .select({ contentId: fluencyAttempts.contentId, last: sql<string>`max(${fluencyAttempts.createdAt})`, n: sql<number>`count(*)::int` })
      .from(fluencyAttempts)
      .where(eq(fluencyAttempts.userId, userId))
      .groupBy(fluencyAttempts.contentId),
  ]);
  const learner = { reading: levels[0].level, listening: levels[1].level };
  const usage = new Map(used.map((u) => [u.contentId, { last: new Date(u.last), n: u.n }]));
  const texts: FluencyText[] = [];
  for (const r of rows) {
    const type = r.type as MaterialType;
    const why = r.completedAt ? "completed" : levelFit(r.level, learner[type]) === "easier" ? "easier" : null;
    if (!why) continue;
    const u = usage.get(r.id);
    texts.push({
      id: r.id,
      type,
      titleEn: r.titleEn,
      titleZh: r.titleZh,
      level: r.level,
      levelLabel: levelLabel(r.level),
      wordCount: (r.meta as { wordCount: number }).wordCount,
      why,
      questionCount: (r.content as StoredContent).questions.length,
      lastPractisedAt: u?.last ?? null,
      practiceCount: u?.n ?? 0,
    });
  }
  // Never practised first, then the longest ago; finished texts before merely easier ones.
  return texts.sort(
    (a, b) =>
      (a.lastPractisedAt?.getTime() ?? 0) - (b.lastPractisedAt?.getTime() ?? 0) ||
      (a.why === b.why ? 0 : a.why === "completed" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
}

export type FluencyPracticeText = {
  id: string;
  type: MaterialType;
  titleEn: string;
  titleZh: string;
  level: string;
  levelLabel: string;
  wordCount: number;
  segments: { speaker: string | null; en: string }[];
  /** Prompt words for retelling. */
  cues: string[];
  /** Questions without answer keys (speed reading). */
  questions: { id: string; promptZh: string; promptEn: string | null; options: string[] }[];
  retellLimitsMs: [number, number, number];
  /** Not finished and not below the learner's level: allowed, with a note. */
  notYetEasy: boolean;
};

async function loadSegments(db: DbExecutor, contentId: string) {
  return db
    .select({ speaker: transcriptSegments.speaker, en: transcriptSegments.textEn })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.contentId, contentId))
    .orderBy(asc(transcriptSegments.sequence));
}

export async function getFluencyText(db: DbExecutor, userId: string, contentId: string): Promise<FluencyPracticeText> {
  const m = await getVisibleMaterial(db, userId, contentId);
  const type = m.type as MaterialType;
  const [segments, [state], learner] = await Promise.all([
    loadSegments(db, contentId),
    db
      .select({ completedAt: userContentState.completedAt })
      .from(userContentState)
      .where(and(eq(userContentState.userId, userId), eq(userContentState.contentId, contentId))),
    learnerInputLevel(db, userId, type),
  ]);
  const lines = segments.map((s) => s.en);
  return {
    id: m.id,
    type,
    titleEn: m.titleEn,
    titleZh: m.titleZh,
    level: m.cefrLevel,
    levelLabel: levelLabel(m.cefrLevel),
    wordCount: wordCountOf(lines),
    segments,
    cues: retellCues(lines, m.stored.glossary),
    questions: m.stored.questions.map((q) => ({ id: q.id, promptZh: q.prompt_zh, promptEn: q.prompt_en ?? null, options: q.options })),
    retellLimitsMs: retellLimitsMs(m.cefrLevel),
    notYetEasy: !state?.completedAt && levelFit(m.cefrLevel, learner.level) !== "easier",
  };
}

// ----------------------------------------------------------------- submit ----

export type FluencySubmission = {
  kind: FluencyKind;
  contentId: string;
  clientRequestId: string;
  rounds: { ms: number; rating?: "smooth" | "ok" | "stuck" }[];
  answers?: { questionId: string; choice: number }[];
  durationMs: number;
};

export type FluencyResult = {
  attemptId: string;
  kind: FluencyKind;
  wordCount: number;
  rounds: FluencyRound[];
  correctCount: number | null;
  questionCount: number | null;
  /** Speed reading: whether this speed counts (enough questions right). */
  counted: boolean;
  /** Repeated reading / retelling: first round vs last, in % (positive = faster). */
  gainPct: number | null;
  /** Speed reading: the right answers (shown after the check). */
  review: { questionId: string; isCorrect: boolean; correctAnswer: string }[];
  /** For comparison: speed reading → average of the last counted results; repeated reading → last time's final round on this text. */
  previousWpm: number | null;
  duplicate: boolean;
};

/** Average speed of the last few counted speed readings before `before`. */
async function previousSpeed(db: DbExecutor, userId: string, before: Date, excludeId?: string): Promise<number | null> {
  const rows = await db
    .select({ id: fluencyAttempts.id, rounds: fluencyAttempts.rounds, correct: fluencyAttempts.correctCount, total: fluencyAttempts.questionCount })
    .from(fluencyAttempts)
    .where(and(eq(fluencyAttempts.userId, userId), eq(fluencyAttempts.kind, "speed_reading"), sql`${fluencyAttempts.createdAt} <= ${before.toISOString()}::timestamptz`))
    .orderBy(desc(fluencyAttempts.createdAt))
    .limit(12);
  const counted = rows.filter((r) => r.id !== excludeId && speedCounts(r.correct, r.total)).slice(0, 3);
  if (counted.length === 0) return null;
  return Math.round(counted.reduce((n, r) => n + (r.rounds[0]?.wpm ?? 0), 0) / counted.length);
}

async function previousFinalRound(db: DbExecutor, userId: string, contentId: string, before: Date, excludeId?: string): Promise<number | null> {
  const rows = await db
    .select({ id: fluencyAttempts.id, rounds: fluencyAttempts.rounds })
    .from(fluencyAttempts)
    .where(
      and(
        eq(fluencyAttempts.userId, userId),
        eq(fluencyAttempts.kind, "repeated_reading"),
        eq(fluencyAttempts.contentId, contentId),
        sql`${fluencyAttempts.createdAt} <= ${before.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(fluencyAttempts.createdAt))
    .limit(2);
  const prev = rows.find((r) => r.id !== excludeId);
  return prev?.rounds.at(-1)?.wpm ?? null;
}

async function toResult(db: DbExecutor, userId: string, row: typeof fluencyAttempts.$inferSelect, review: FluencyResult["review"], duplicate: boolean): Promise<FluencyResult> {
  const kind = row.kind as FluencyKind;
  const previousWpm =
    kind === "speed_reading"
      ? await previousSpeed(db, userId, row.createdAt, row.id)
      : kind === "repeated_reading"
        ? await previousFinalRound(db, userId, row.contentId, row.createdAt, row.id)
        : null;
  return {
    attemptId: row.id,
    kind,
    wordCount: row.wordCount,
    rounds: row.rounds,
    correctCount: row.correctCount,
    questionCount: row.questionCount,
    counted: kind === "speed_reading" ? speedCounts(row.correctCount, row.questionCount) : true,
    gainPct: kind === "speed_reading" ? null : roundGain(row.rounds),
    review,
    previousWpm,
    duplicate,
  };
}

/** Store a finished activity. Idempotent by client request id. */
export async function submitFluencyAttempt(db: DbExecutor, userId: string, input: FluencySubmission, now = new Date()): Promise<FluencyResult> {
  const m = await getVisibleMaterial(db, userId, input.contentId);
  const questions = m.stored.questions;
  const reviewOf = (answers: { questionId: string; choice: number }[]) =>
    questions.map((q) => {
      const a = answers.find((x) => x.questionId === q.id);
      return { questionId: q.id, isCorrect: a?.choice === q.answer, correctAnswer: q.options[q.answer]! };
    });

  const [existing] = await db
    .select()
    .from(fluencyAttempts)
    .where(and(eq(fluencyAttempts.userId, userId), eq(fluencyAttempts.clientRequestId, input.clientRequestId)));
  if (existing) return toResult(db, userId, existing, existing.kind === "speed_reading" ? reviewOf(input.answers ?? []) : [], true);

  if (input.rounds.length !== ROUNDS[input.kind]) throw new FluencyInputError("轮数不对，请重新开始这项练习。");
  if (input.rounds.some((r) => !Number.isInteger(r.ms) || r.ms < MIN_ROUND_MS || r.ms > MAX_ROUND_MS)) {
    throw new FluencyInputError("有一轮的用时不正常（太短或太长），请重新开始这项练习。");
  }

  const wordCount = wordCountOf((await loadSegments(db, m.id)).map((s) => s.en));
  let rounds: FluencyRound[];
  let correctCount: number | null = null;
  let questionCount: number | null = null;
  let review: FluencyResult["review"] = [];

  if (input.kind === "timed_retell") {
    const limits = retellLimitsMs(m.cefrLevel);
    rounds = input.rounds.map((r, i) => {
      if (!r.rating) throw new FluencyInputError("每一轮讲完后请选一下感觉如何。");
      // A little slack for the moment between "time's up" and the request.
      if (r.ms > limits[i]! + 3_000) throw new FluencyInputError("有一轮超过了限定时间，请重新开始这项练习。");
      return { ms: r.ms, limitMs: limits[i]!, rating: r.rating };
    });
  } else {
    const max = MAX_WPM[input.kind];
    rounds = input.rounds.map((r) => ({ ms: r.ms, wpm: wordsPerMinute(wordCount, r.ms) }));
    if (rounds.some((r) => r.wpm! > max)) throw new FluencyInputError("这一遍用时太短，看起来没有读完。请按平时能读懂的速度再试一次。");
    if (input.kind === "speed_reading" && questions.length > 0) {
      const answers = input.answers ?? [];
      if (questions.some((q) => !answers.some((a) => a.questionId === q.id && a.choice >= 0 && a.choice < q.options.length))) {
        throw new FluencyInputError("请先回答完所有理解题。");
      }
      review = reviewOf(answers);
      correctCount = review.filter((r) => r.isCorrect).length;
      questionCount = questions.length;
    }
  }

  const roundsTotal = rounds.reduce((n, r) => n + r.ms, 0);
  const durationMs = Math.min(MAX_DURATION_MS, Math.max(roundsTotal, Math.round(input.durationMs) || 0));
  const [row] = await db
    .insert(fluencyAttempts)
    .values({
      userId,
      kind: input.kind,
      contentId: m.id,
      level: m.cefrLevel,
      wordCount,
      rounds,
      correctCount,
      questionCount,
      durationMs,
      clientRequestId: input.clientRequestId,
      createdAt: now,
    })
    .onConflictDoNothing({ target: fluencyAttempts.clientRequestId })
    .returning();
  if (!row) {
    // Lost a race with the same request (a retry): report the stored one.
    const [stored] = await db
      .select()
      .from(fluencyAttempts)
      .where(and(eq(fluencyAttempts.userId, userId), eq(fluencyAttempts.clientRequestId, input.clientRequestId)));
    if (!stored) throw new FluencyInputError("这次练习没有保存成功，请重试。");
    return toResult(db, userId, stored, review, true);
  }
  return toResult(db, userId, row, review, false);
}

// --------------------------------------------------------------- overview ----

export type FluencyRecord = {
  id: string;
  kind: FluencyKind;
  contentId: string;
  titleEn: string;
  titleZh: string;
  levelLabel: string;
  at: Date;
  rounds: FluencyRound[];
  correctCount: number | null;
  questionCount: number | null;
  counted: boolean;
};

export async function listFluencyAttempts(db: DbExecutor, userId: string, limit = 20): Promise<FluencyRecord[]> {
  const rows = await db
    .select({ a: fluencyAttempts, titleEn: learningContents.titleEn, titleZh: learningContents.titleZh })
    .from(fluencyAttempts)
    .innerJoin(learningContents, eq(learningContents.id, fluencyAttempts.contentId))
    .where(eq(fluencyAttempts.userId, userId))
    .orderBy(desc(fluencyAttempts.createdAt))
    .limit(limit);
  return rows.map(({ a, titleEn, titleZh }) => ({
    id: a.id,
    kind: a.kind as FluencyKind,
    contentId: a.contentId,
    titleEn,
    titleZh,
    levelLabel: levelLabel(a.level),
    at: a.createdAt,
    rounds: a.rounds,
    correctCount: a.correctCount,
    questionCount: a.questionCount,
    counted: a.kind === "speed_reading" ? speedCounts(a.correctCount, a.questionCount) : true,
  }));
}

/** Reading speed over time: counted speed readings, oldest first (at most the last 12). */
export async function speedReadingHistory(db: DbExecutor, userId: string) {
  const rows = await db
    .select({ at: fluencyAttempts.createdAt, rounds: fluencyAttempts.rounds, correct: fluencyAttempts.correctCount, total: fluencyAttempts.questionCount })
    .from(fluencyAttempts)
    .where(and(eq(fluencyAttempts.userId, userId), eq(fluencyAttempts.kind, "speed_reading")))
    .orderBy(desc(fluencyAttempts.createdAt))
    .limit(40);
  const counted = rows.filter((r) => speedCounts(r.correct, r.total)).slice(0, 12).reverse();
  const points = counted.map((r) => ({ at: r.at, wpm: r.rounds[0]?.wpm ?? 0 }));
  const avg = (list: { wpm: number }[]) => (list.length ? Math.round(list.reduce((n, p) => n + p.wpm, 0) / list.length) : null);
  return {
    points,
    recentAvg: avg(points.slice(-3)),
    earlierAvg: points.length >= 6 ? avg(points.slice(-6, -3)) : null,
    notCounted: rows.length - rows.filter((r) => speedCounts(r.correct, r.total)).length,
  };
}

/** Fluency study minutes since a moment (same cap as the weekly activity). */
export async function fluencyMinutesSince(db: DbExecutor, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ ms: sql<number>`coalesce(sum(least(${fluencyAttempts.durationMs}, ${MAX_DURATION_MS})), 0)::int` })
    .from(fluencyAttempts)
    .where(and(eq(fluencyAttempts.userId, userId), gte(fluencyAttempts.createdAt, since)));
  return Math.round((row?.ms ?? 0) / 6_000) / 10;
}

// ------------------------------------------------------------------- plan ----

export type FluencyRef = {
  kind: FluencyKind;
  contentId: string;
  titleEn: string;
  titleZh: string;
  levelLabel: string;
  why: "completed" | "easier";
  weekMinutes: number;
  weekTarget: number;
};

/**
 * Today's fluency task (if the week is short of its target): the least
 * recently practised easy text, and the activity done least in two weeks.
 */
export async function pickFluencyTask(db: DbExecutor, userId: string, opts: { now: Date; weekStart: Date; dayStart: Date; level: string | null; /** Suggest even when the week's target is met (the Fluency page). */ always?: boolean }): Promise<FluencyRef | null> {
  const weekTarget = weeklyFluencyTarget(opts.level);
  const [weekMinutes, texts, recent] = await Promise.all([
    fluencyMinutesSince(db, userId, opts.weekStart),
    listFluencyTexts(db, userId),
    db
      .select({ kind: fluencyAttempts.kind, n: sql<number>`count(*)::int`, today: sql<number>`count(*) filter (where ${fluencyAttempts.createdAt} >= ${opts.dayStart.toISOString()}::timestamptz)::int` })
      .from(fluencyAttempts)
      .where(and(eq(fluencyAttempts.userId, userId), gte(fluencyAttempts.createdAt, new Date(opts.now.getTime() - 14 * 86_400_000))))
      .groupBy(fluencyAttempts.kind),
  ]);
  if (!opts.always && (weekMinutes >= weekTarget || recent.some((r) => r.today > 0))) return null;
  const counts = Object.fromEntries(recent.map((r) => [r.kind, r.n])) as Partial<Record<FluencyKind, number>>;
  const kind = suggestKind(opts.level, counts);
  // Speed reading needs questions to check understanding; other activities take any text.
  const text = texts.find((t) => kind !== "speed_reading" || t.questionCount > 0) ?? texts[0];
  if (!text) return null;
  return {
    kind: kind === "speed_reading" && text.questionCount === 0 ? "repeated_reading" : kind,
    contentId: text.id,
    titleEn: text.titleEn,
    titleZh: text.titleZh,
    levelLabel: text.levelLabel,
    why: text.why,
    weekMinutes,
    weekTarget,
  };
}

/** Fluency attempts on these texts since a moment (for "done" on the Today plan). */
export async function fluencyDoneSince(db: DbExecutor, userId: string, contentIds: string[], since: Date) {
  if (contentIds.length === 0) return [];
  return db
    .select({ contentId: fluencyAttempts.contentId, kind: fluencyAttempts.kind, at: fluencyAttempts.createdAt })
    .from(fluencyAttempts)
    .where(and(eq(fluencyAttempts.userId, userId), inArray(fluencyAttempts.contentId, contentIds), gte(fluencyAttempts.createdAt, since)));
}
