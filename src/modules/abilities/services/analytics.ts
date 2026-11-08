import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";

/**
 * The learning-record figures for the progress page (spec §5.15) that aren't
 * covered elsewhere: reading and listening comprehension by level, listening
 * replays and dictation, speaking task completion, and how writing error
 * categories change. Everything comes from real records; nothing is blended
 * into a single score.
 */

export type RateByLevel = { level: string; answered: number; correct: number };

export type SkillAnalytics = {
  reading: { byLevel: RateByLevel[]; answered: number; correct: number; recentAnswered: number; recentCorrect: number; completed: number };
  listening: {
    byLevel: RateByLevel[];
    answered: number;
    correct: number;
    recentAnswered: number;
    recentCorrect: number;
    /** Average replays per listening material the learner played. */
    replaysPerMaterial: number | null;
    dictation: { attempts: number; correct: number };
  };
  speaking: { sessions: number; withFeedback: number; met: number; partly: number; notMet: number; wordsPerTurn: number | null; minutes: number };
  writing: { texts: number; earlier: Record<string, number>; recent: Record<string, number>; earlierCount: number; recentCount: number };
};

const RECENT_DAYS = 30;

export async function getSkillAnalytics(db: DbExecutor, userId: string, now = new Date()): Promise<SkillAnalytics> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();

  const questions = await db.execute<{ type: string; level: string; answered: number; correct: number; recent_answered: number; recent_correct: number }>(sql`
    select c.type, c.cefr_level as level, count(*)::int as answered, count(*) filter (where i.is_correct)::int as correct,
           count(*) filter (where i.created_at >= ${since}::timestamptz)::int as recent_answered,
           count(*) filter (where i.is_correct and i.created_at >= ${since}::timestamptz)::int as recent_correct
    from content_interactions i join learning_contents c on c.id = i.content_id
    where i.user_id = ${userId} and i.kind = 'question'
    group by c.type, c.cefr_level
  `);
  const [completedRow] = await db.execute<{ reading: number }>(sql`
    select count(distinct i.content_id) filter (where c.type = 'reading')::int as reading
    from content_interactions i join learning_contents c on c.id = i.content_id
    where i.user_id = ${userId} and i.kind = 'complete'
  `);
  const [replays] = await db.execute<{ replays: number; materials: number }>(sql`
    select count(*) filter (where i.kind = 'replay')::int as replays,
           count(distinct i.content_id) filter (where i.kind in ('play', 'replay'))::int as materials
    from content_interactions i join learning_contents c on c.id = i.content_id
    where i.user_id = ${userId} and c.type = 'listening'
  `);
  const [dictation] = await db.execute<{ attempts: number; correct: number }>(sql`
    select count(*)::int as attempts, count(*) filter (where is_correct)::int as correct
    from content_interactions where user_id = ${userId} and kind = 'dictation'
  `);

  const strand = (type: string) => {
    const rows = questions.filter((q) => q.type === type);
    const order = ["pre_a1", "a1", "a2", "b1", "b2", "c1", "c2"];
    return {
      byLevel: rows.map((r) => ({ level: r.level, answered: r.answered, correct: r.correct })).sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)),
      answered: rows.reduce((s, r) => s + r.answered, 0),
      correct: rows.reduce((s, r) => s + r.correct, 0),
      recentAnswered: rows.reduce((s, r) => s + r.recent_answered, 0),
      recentCorrect: rows.reduce((s, r) => s + r.recent_correct, 0),
    };
  };

  const [speaking] = await db.execute<{ sessions: number; with_feedback: number; met: number; partly: number; not_met: number; words: number; turns: number; seconds: number }>(sql`
    select count(*)::int as sessions,
           count(*) filter (where evaluation is not null)::int as with_feedback,
           count(*) filter (where evaluation->'task_completion'->>'rating' = 'met')::int as met,
           count(*) filter (where evaluation->'task_completion'->>'rating' = 'partly')::int as partly,
           count(*) filter (where evaluation->'task_completion'->>'rating' = 'not_met')::int as not_met,
           coalesce(sum(learner_words), 0)::int as words, coalesce(sum(learner_turns), 0)::int as turns,
           coalesce(sum(duration_seconds), 0)::int as seconds
    from speaking_attempts where user_id = ${userId} and status = 'ended'
  `);

  // Writing: grammar categories in the earlier vs the most recent texts (up to 5 each).
  const writing = await db.execute<{ feedback: { grammar?: { category?: string }[] } }>(sql`
    select feedback from writing_submissions
    where user_id = ${userId} and feedback is not null
    order by created_at asc
  `);
  const half = Math.min(5, Math.floor(writing.length / 2));
  const count = (rows: { feedback: { grammar?: { category?: string }[] } }[]) => {
    const out: Record<string, number> = {};
    for (const r of rows) for (const g of r.feedback.grammar ?? []) if (g.category) out[g.category] = (out[g.category] ?? 0) + 1;
    return out;
  };

  return {
    reading: { ...strand("reading"), completed: completedRow?.reading ?? 0 },
    listening: {
      ...strand("listening"),
      replaysPerMaterial: replays && replays.materials > 0 ? Math.round((replays.replays / replays.materials) * 10) / 10 : null,
      dictation: { attempts: dictation?.attempts ?? 0, correct: dictation?.correct ?? 0 },
    },
    speaking: {
      sessions: speaking?.sessions ?? 0,
      withFeedback: speaking?.with_feedback ?? 0,
      met: speaking?.met ?? 0,
      partly: speaking?.partly ?? 0,
      notMet: speaking?.not_met ?? 0,
      wordsPerTurn: speaking && speaking.turns > 0 ? Math.round((speaking.words / speaking.turns) * 10) / 10 : null,
      minutes: Math.round((speaking?.seconds ?? 0) / 60),
    },
    writing: {
      texts: writing.length,
      earlier: half > 0 ? count(writing.slice(0, half)) : {},
      recent: half > 0 ? count(writing.slice(-half)) : {},
      earlierCount: half,
      recentCount: half,
    },
  };
}
