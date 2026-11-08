import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { canDoEvidence } from "@/db/schema";

import { loadCanDo, type CanDoStatement } from "../content";
import { CONFIDENCE_WEIGHT, canDoStatus, type StatusResult } from "../domain/status";

/**
 * Can-do evidence (spec §2.1, §8.7). Evidence is collected from the practice
 * records that already exist — lesson steps, grammar exercises, comprehension
 * questions and dictation, speaking sessions with feedback, writing with
 * feedback — so every piece links back to something the learner really did.
 *
 * Collection is idempotent (one row per statement and source record) and runs
 * before the ability map is read. Evidence from a record the learner deleted
 * (a speaking session, a piece of writing) is removed with it.
 */

type Confidence = "low" | "medium" | "high";
type Row = typeof canDoEvidence.$inferInsert;

const SELF_SCORE_PASS = 0.67;

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

function evidence(userId: string, canDoId: string, source: string, sourceRef: string, pass: boolean, confidence: Confidence, occurredAt: string | Date, detail: Row["detail"]): Row {
  return { userId, canDoId, source, sourceRef, outcome: pass ? "pass" : "fail", confidence, weight: CONFIDENCE_WEIGHT[confidence], detail, occurredAt: toDate(occurredAt) };
}

/** Collect any new evidence for one learner. Returns how many rows were added. */
export async function syncCanDoEvidence(db: DbExecutor, userId: string, timeZone = "UTC"): Promise<number> {
  const { statements, links } = loadCanDo();
  const skillOf = new Map(statements.map((s) => [s.id, s.skill]));
  const rows: Row[] = [];

  // 1. Lesson steps: first attempt of an assessed step, for the lesson's can-do statements of the same skill.
  const steps = await db.execute<{ id: string; lesson_id: string; step_key: string; skill: string; is_correct: boolean | null; self_score: number | null; created_at: string }>(sql`
    select a.id, a.lesson_id, a.step_key, s.skill, a.is_correct, a.self_score, a.created_at
    from lesson_step_attempts a
    join lesson_steps s on s.lesson_id = a.lesson_id and s.step_key = a.step_key
    where a.user_id = ${userId} and a.attempt_no = 1 and s.assessed and (a.is_correct is not null or a.self_score is not null)
  `);
  for (const r of steps) {
    for (const id of links.lessons.get(r.lesson_id) ?? []) {
      if (skillOf.get(id) !== r.skill) continue;
      const objective = r.is_correct !== null;
      rows.push(evidence(userId, id, "lesson_step", r.id, objective ? r.is_correct! : (r.self_score ?? 0) >= SELF_SCORE_PASS, objective ? "medium" : "low", r.created_at, { lessonId: r.lesson_id, stepKey: r.step_key }));
    }
  }

  // 2. Grammar exercises: the first scored attempt of each exercise per day (retries the same day don't add up).
  const exercises = await db.execute<{ id: string; exercise_id: string; grammar_point_id: string | null; is_correct: boolean; created_at: string }>(sql`
    select distinct on (x.exercise_id, x.day) x.id, x.exercise_id, x.grammar_point_id, x.is_correct, x.created_at
    from (
      select a.id, a.exercise_id, e.grammar_point_id, a.is_correct, a.created_at, (a.created_at at time zone ${timeZone})::date as day
      from exercise_attempts a
      join exercises e on e.id = a.exercise_id
      where a.user_id = ${userId} and a.is_correct is not null
    ) x
    order by x.exercise_id, x.day, x.created_at
  `);
  for (const r of exercises) {
    for (const id of (r.grammar_point_id && links.grammarPoints.get(r.grammar_point_id)) || []) {
      rows.push(evidence(userId, id, "exercise", r.id, r.is_correct, "medium", r.created_at, { pointId: r.grammar_point_id, exerciseId: r.exercise_id }));
    }
  }

  // 3. Comprehension questions and dictation on built-in materials.
  const answers = await db.execute<{ id: string; content_id: string; kind: string; type: string; is_correct: boolean; created_at: string }>(sql`
    select i.id, i.content_id, i.kind, c.type, i.is_correct, i.created_at
    from content_interactions i
    join learning_contents c on c.id = i.content_id
    where i.user_id = ${userId} and i.kind in ('question', 'dictation') and i.is_correct is not null and c.owner_user_id is null
  `);
  for (const r of answers) {
    for (const id of links.materials.get(r.content_id) ?? []) {
      if (r.kind === "dictation" && skillOf.get(id) !== "listening") continue;
      rows.push(evidence(userId, id, r.kind === "dictation" ? "dictation" : "material_question", r.id, r.is_correct, "medium", r.created_at, { contentId: r.content_id, type: r.type }));
    }
  }

  // 4. Speaking sessions with feedback: the task done and understandable.
  const speaking = await db.execute<{ id: string; prompt_id: string; evaluation: { task_completion?: { rating?: string }; comprehensibility?: { rating?: string }; confidence?: string }; ended_at: string }>(sql`
    select id, prompt_id, evaluation, coalesce(ended_at, created_at) as ended_at
    from speaking_attempts
    where user_id = ${userId} and status = 'ended' and evaluation is not null
  `);
  for (const r of speaking) {
    const conf = (["low", "medium", "high"].includes(r.evaluation.confidence ?? "") ? r.evaluation.confidence : "low") as Confidence;
    const pass = r.evaluation.task_completion?.rating === "met" && r.evaluation.comprehensibility?.rating !== "hard_to_follow";
    for (const id of links.speakingTasks.get(r.prompt_id) ?? []) rows.push(evidence(userId, id, "speaking", r.id, pass, conf, r.ended_at, { taskId: r.prompt_id }));
  }

  // 5. Writing with feedback: the task completed.
  const writing = await db.execute<{ id: string; prompt_id: string; feedback: { task_completion?: { rating?: string } }; confidence: string | null; created_at: string }>(sql`
    select id, prompt_id, feedback, confidence, created_at
    from writing_submissions
    where user_id = ${userId} and prompt_id is not null and feedback is not null and status in ('feedback', 'revised')
  `);
  for (const r of writing) {
    const conf = (["low", "medium", "high"].includes(r.confidence ?? "") ? r.confidence : "low") as Confidence;
    for (const id of links.writingPrompts.get(r.prompt_id) ?? []) rows.push(evidence(userId, id, "writing", r.id, r.feedback.task_completion?.rating === "met", conf, r.created_at, { promptId: r.prompt_id }));
  }

  // Deleted speaking sessions / writing take their evidence with them.
  await db.execute(sql`
    delete from can_do_evidence e
    where e.user_id = ${userId}
      and ((e.source = 'speaking' and not exists (select 1 from speaking_attempts s where s.id::text = e.source_ref))
        or (e.source = 'writing' and not exists (select 1 from writing_submissions w where w.id::text = e.source_ref)))
  `);

  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await db.insert(canDoEvidence).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: canDoEvidence.id });
    added += inserted.length;
  }
  return added;
}

export type EvidenceView = {
  id: string;
  source: string;
  outcome: "pass" | "fail";
  confidence: Confidence;
  occurredAt: Date;
  label: string;
  href: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  lesson_step: "课程练习",
  exercise: "语法练习",
  material_question: "理解题",
  dictation: "听写",
  speaking: "口语练习",
  writing: "写作",
};

function hrefFor(source: string, ref: string, detail: Record<string, string | number | null>): string | null {
  switch (source) {
    case "lesson_step":
      return detail.lessonId ? `/lesson/${detail.lessonId}` : null;
    case "exercise":
      return detail.pointId ? `/grammar/${detail.pointId}` : null;
    case "material_question":
    case "dictation":
      return detail.contentId ? `/${detail.type === "listening" ? "listening" : "reading"}/${detail.contentId}` : null;
    case "speaking":
      return `/speaking/attempts/${ref}`;
    case "writing":
      return `/writing/${ref}`;
    default:
      return null;
  }
}

export type AbilityItem = CanDoStatement & { result: StatusResult; recent: EvidenceView[] };

/** Every can-do statement with its status and latest evidence (collects new evidence first). */
export async function getAbilityMap(db: DbExecutor, userId: string, timeZone: string, now = new Date()): Promise<AbilityItem[]> {
  await syncCanDoEvidence(db, userId, timeZone);
  const { statements } = loadCanDo();
  const rows = await db
    .select()
    .from(canDoEvidence)
    .where(and(eq(canDoEvidence.userId, userId), inArray(canDoEvidence.canDoId, statements.map((s) => s.id))))
    .orderBy(desc(canDoEvidence.occurredAt));
  const byId = new Map<string, typeof rows>();
  for (const r of rows) byId.set(r.canDoId, [...(byId.get(r.canDoId) ?? []), r]);
  return statements.map((s) => {
    const mine = byId.get(s.id) ?? [];
    const result = canDoStatus(
      mine.map((e) => ({ outcome: e.outcome as "pass" | "fail", confidence: e.confidence as Confidence, weight: e.weight, occurredAt: e.occurredAt })),
      s.passRule,
      timeZone,
      now,
    );
    const recent = mine.slice(0, 8).map((e) => ({
      id: e.id,
      source: e.source,
      outcome: e.outcome as "pass" | "fail",
      confidence: e.confidence as Confidence,
      occurredAt: e.occurredAt,
      label: SOURCE_LABELS[e.source] ?? e.source,
      href: hrefFor(e.source, e.sourceRef, e.detail),
    }));
    return { ...s, result, recent };
  });
}

/** Counts per level for the progress page. */
export function summarizeAbilities(items: AbilityItem[]) {
  const levels = new Map<string, { total: number; shown: number; emerging: number; stale: number }>();
  for (const i of items) {
    const l = levels.get(i.level) ?? { total: 0, shown: 0, emerging: 0, stale: 0 };
    l.total += 1;
    if (i.result.status === "shown") l.shown += 1;
    if (i.result.status === "emerging") l.emerging += 1;
    if (i.result.stale) l.stale += 1;
    levels.set(i.level, l);
  }
  return [...levels].map(([level, counts]) => ({ level, ...counts }));
}
