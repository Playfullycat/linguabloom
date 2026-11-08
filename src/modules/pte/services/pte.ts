import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { examVersions, pteAttempts, ptePrompts, pteRubrics, pteTaskTypes, type ErrorCategory } from "@/db/schema";
import { getEnv, type Env } from "@/lib/config/env";
import { AIError } from "@/modules/ai/provider/errors";
import type { AIProvider } from "@/modules/ai/provider/types";
import { runAI } from "@/modules/ai/services/usage";
import { recordError } from "@/modules/errors/services/errors";
import { getLearnerSettings } from "@/modules/learner/services/profile";

import { audioScript, learnerView, loadPte, type LearnerView, type PracticeTaskCode, type Prompt, type TaskCode } from "../content";
import { parsePteWrittenFeedback, sstFeedbackPrompt, type PteWrittenFeedback } from "../domain/feedback";
import { scoreObjective, sstForm, type ItemMark, type Response } from "../domain/scoring";

/**
 * PTE practice (spec §5.13, §8.8, §9.6). Every attempt is bound to the
 * current exam version and to the prompt's content version, and keeps a
 * snapshot of what it was scored against, so later versions never change it.
 */

export class PteNotFoundError extends Error {}
export class PteRejectedError extends Error {}

export type TaskTypeRow = typeof pteTaskTypes.$inferSelect & {
  timing: { suggested_seconds?: number; response_minutes?: number } & Record<string, unknown>;
  scoring: { official_zh: string; method: string; partial_credit: boolean; negative_marking: boolean; rule_zh?: string; unconfirmed?: boolean };
};

export async function getCurrentVersion(db: DbExecutor) {
  const [v] = await db.select().from(examVersions).where(eq(examVersions.isCurrent, true)).limit(1);
  if (!v) throw new PteNotFoundError("no current exam version");
  return v;
}

export async function listTaskTypes(db: DbExecutor, versionId: string): Promise<TaskTypeRow[]> {
  return (await db.select().from(pteTaskTypes).where(eq(pteTaskTypes.examVersionId, versionId)).orderBy(asc(pteTaskTypes.sortOrder))) as TaskTypeRow[];
}

export async function getTaskType(db: DbExecutor, versionId: string, code: string): Promise<TaskTypeRow> {
  const [t] = await db
    .select()
    .from(pteTaskTypes)
    .where(and(eq(pteTaskTypes.examVersionId, versionId), eq(pteTaskTypes.code, code)));
  if (!t) throw new PteNotFoundError(code);
  return t as TaskTypeRow;
}

/** Per task type: attempts, average share of points, last attempt (objective tasks only count for the average). */
export async function taskStats(db: DbExecutor, userId: string) {
  const rows = await db.execute<{ task_code: string; attempts: number; avg_share: number | null; last_at: string }>(sql`
    select task_code, count(*)::int as attempts,
           avg(case when max_score > 0 then score / max_score end)::float as avg_share,
           max(created_at) as last_at
    from pte_attempts where user_id = ${userId}
    group by task_code
  `);
  return new Map(rows.map((r) => [r.task_code, { attempts: r.attempts, avgShare: r.avg_share, lastAt: new Date(r.last_at) }]));
}

export async function listPrompts(db: DbExecutor, userId: string, taskCode: string) {
  const prompts = await db
    .select({ id: ptePrompts.id, titleZh: ptePrompts.titleZh, difficulty: ptePrompts.difficulty })
    .from(ptePrompts)
    .where(and(eq(ptePrompts.taskCode, taskCode), isNull(ptePrompts.archivedAt)))
    .orderBy(asc(ptePrompts.difficulty), asc(ptePrompts.id));
  const best = await db.execute<{ prompt_id: string; best: number | null; attempts: number }>(sql`
    select prompt_id, max(case when max_score > 0 then score / max_score end)::float as best, count(*)::int as attempts
    from pte_attempts where user_id = ${userId} and task_code = ${taskCode}
    group by prompt_id
  `);
  const byId = new Map(best.map((b) => [b.prompt_id, b]));
  return prompts.map((p) => ({ ...p, best: byId.get(p.id)?.best ?? null, attempts: byId.get(p.id)?.attempts ?? 0 }));
}

function promptFromContent(id: string): Prompt {
  const p = loadPte().prompts.find((x) => x.id === id);
  if (!p) throw new PteNotFoundError(id);
  return p;
}

async function livePrompt(db: DbExecutor, id: string) {
  const [row] = await db
    .select()
    .from(ptePrompts)
    .where(and(eq(ptePrompts.id, id), isNull(ptePrompts.archivedAt)));
  if (!row) throw new PteNotFoundError(id);
  return { row, prompt: promptFromContent(id) };
}

export type PracticeItem = {
  promptId: string;
  titleZh: string;
  difficulty: number;
  taskCode: PracticeTaskCode;
  view: LearnerView;
  hasAudio: boolean;
  /** Suggested (or official, for SST) time in timed mode. */
  timeLimitSeconds: number;
  /** True when the limit is the official one; otherwise it's a practice suggestion. */
  officialTime: boolean;
};

/** Official time (SST: 10 minutes) or this app's suggestion for timed practice. */
function timeLimitFor(type: TaskTypeRow) {
  const official = typeof type.timing.response_minutes === "number";
  return { official, seconds: official ? Math.round(type.timing.response_minutes! * 60) : (type.timing.suggested_seconds ?? 120) };
}

/** What the browser gets for one practice item: no answers, no listening script. */
export async function getPracticeItem(db: DbExecutor, promptId: string): Promise<PracticeItem> {
  const { row, prompt } = await livePrompt(db, promptId);
  const version = await getCurrentVersion(db);
  const type = await getTaskType(db, version.id, prompt.task);
  if (!type.practiceAvailable) throw new PteNotFoundError(prompt.task);
  const { seconds, official } = timeLimitFor(type);
  return {
    promptId: row.id,
    titleZh: row.titleZh,
    difficulty: row.difficulty,
    taskCode: prompt.task,
    view: learnerView(prompt),
    hasAudio: audioScript(prompt) !== null,
    timeLimitSeconds: seconds,
    officialTime: official,
  };
}

/** The words the audio says — for speech synthesis, and for browser speech when no speech model is configured. */
export function getAudioScript(promptId: string): string {
  const s = audioScript(promptFromContent(promptId));
  if (!s) throw new PteNotFoundError(promptId);
  return s;
}

/** After answering: the key, the explanation and the transcript. */
export type Reveal = {
  explanationZh: string | null;
  transcript: string | null;
  modelAnswer: string | null;
  keyPointsZh: string[];
};

function reveal(p: Prompt): Reveal {
  const c = p.content as { explanation_zh?: string; model_summary?: string; key_points_zh?: string[] };
  return {
    explanationZh: c.explanation_zh ?? null,
    transcript: audioScript(p),
    modelAnswer: c.model_summary ?? (p.task === "l_wfd" ? p.content.sentence : null),
    keyPointsZh: c.key_points_zh ?? [],
  };
}

const ERROR_CATEGORY: Partial<Record<TaskCode, ErrorCategory>> = {
  r_fib_dropdown: "collocation",
  r_fib_drag: "collocation",
  r_mcma: "comprehension",
  r_mcsa: "comprehension",
  r_reorder: "comprehension",
  l_mcma: "comprehension",
  l_mcsa: "comprehension",
  l_hcs: "comprehension",
  l_smw: "comprehension",
  l_fib_type: "listening",
  l_hiw: "listening",
  l_wfd: "listening",
};

export type SubmitInput = {
  promptId: string;
  response: Response;
  mode: "practice" | "timed";
  durationMs: number;
  timedOut: boolean;
  clientRequestId: string;
};

export type SubmitResult = {
  attemptId: string;
  score: number | null;
  maxScore: number | null;
  marks: ItemMark[];
  form: ReturnType<typeof sstForm> | null;
  feedback: PteWrittenFeedback | null;
  feedbackError: string | null;
  reveal: Reveal;
  duplicate: boolean;
};

/** Score, store (bound to the exam version), give feedback, record mistakes. Retried requests return the stored result. */
export async function submitAttempt(db: Database, userId: string, input: SubmitInput, provider?: AIProvider | null, env: Env = getEnv()): Promise<SubmitResult> {
  const { row, prompt } = await livePrompt(db, input.promptId);
  const version = await getCurrentVersion(db);
  const type = await getTaskType(db, version.id, prompt.task);
  if (!type.practiceAvailable) throw new PteRejectedError("这个题型还不能练习。");

  const [existing] = await db.select().from(pteAttempts).where(eq(pteAttempts.clientRequestId, input.clientRequestId));
  if (existing) {
    if (existing.userId !== userId) throw new PteRejectedError("请求编号重复。");
    const detail = (existing.scoreDetail as { marks?: ItemMark[]; form?: ReturnType<typeof sstForm> } | null) ?? {};
    return { attemptId: existing.id, score: existing.score, maxScore: existing.maxScore, marks: detail.marks ?? [], form: detail.form ?? null, feedback: existing.feedback as PteWrittenFeedback | null, feedbackError: null, reveal: reveal(prompt), duplicate: true };
  }

  let objective: ReturnType<typeof scoreObjective>;
  try {
    objective = scoreObjective(prompt, input.response);
  } catch {
    throw new PteRejectedError("提交的答案格式不正确。");
  }

  let form: ReturnType<typeof sstForm> | null = null;
  let feedback: PteWrittenFeedback | null = null;
  let feedbackError: string | null = null;
  if (prompt.task === "l_sst") {
    if (input.response.kind !== "text") throw new PteRejectedError("提交的答案格式不正确。");
    const text = input.response.text.trim().slice(0, 2000);
    form = sstForm(text);
    if (form.words > 0) {
      try {
        const { profile } = await getLearnerSettings(db, userId);
        const explanation = (["zh", "mixed", "en"].includes(profile.explanationLanguage) ? profile.explanationLanguage : "zh") as "zh" | "mixed" | "en";
        const { value } = await runAI({ db, userId, task: "pte_feedback", timeZone: profile.timezone, provider, env }, async (ai) => {
          const r = await ai.generateText({
            task: "pte_feedback",
            system: sstFeedbackPrompt(prompt.content.key_points_zh, explanation),
            messages: [{ role: "user", content: `TRANSCRIPT:\n${audioScript(prompt)}\n\nSUMMARY:\n${text}` }],
            json: true,
            maxOutputTokens: Math.max(env.AI_MAX_OUTPUT_TOKENS, 900),
          });
          return { value: parsePteWrittenFeedback(r.text, text), usage: r.usage, model: r.model };
        });
        feedback = value;
      } catch (error) {
        feedbackError = error instanceof AIError ? error.code : "unknown";
      }
    }
  }

  const [attempt] = await db
    .insert(pteAttempts)
    .values({
      userId,
      examVersionId: version.id,
      taskCode: prompt.task,
      promptId: row.id,
      promptVersion: row.contentVersion,
      mode: input.mode,
      response: input.response,
      score: objective?.score ?? null,
      maxScore: objective?.maxScore ?? null,
      scoreDetail: { marks: objective?.marks ?? [], form },
      feedback,
      snapshot: {
        taskNameZh: type.nameZh,
        taskNameEn: type.nameEn,
        scoringMethod: type.scoring.method,
        scoringRuleZh: type.scoring.rule_zh ?? type.scoring.official_zh,
        promptTitleZh: row.titleZh,
        view: learnerView(prompt),
        reveal: reveal(prompt),
      },
      durationMs: Math.max(0, Math.min(Math.round(input.durationMs), 60 * 60_000)),
      timeLimitSeconds: input.mode === "timed" ? timeLimitFor(type).seconds : null,
      timedOut: input.timedOut,
      clientRequestId: input.clientRequestId,
    })
    .returning({ id: pteAttempts.id });

  // Lost points become an error-notebook entry for the task type.
  const category = ERROR_CATEGORY[prompt.task];
  if (objective && category && objective.score < objective.maxScore) {
    const wrong = objective.marks.find((m) => !m.correct);
    await recordError(db, userId, {
      category,
      pointType: "pte",
      pointId: prompt.task,
      title: `PTE · ${type.nameZh}`,
      source: "pte",
      sourceRef: attempt!.id,
      wrong: wrong?.given ?? `${objective.score}/${objective.maxScore}`,
      correct: wrong?.expected ?? null,
    });
  }

  return { attemptId: attempt!.id, score: objective?.score ?? null, maxScore: objective?.maxScore ?? null, marks: objective?.marks ?? [], form, feedback, feedbackError, reveal: reveal(prompt), duplicate: false };
}

export async function listAttempts(db: DbExecutor, userId: string, taskCode?: string, limit = 20) {
  return db
    .select({
      id: pteAttempts.id,
      taskCode: pteAttempts.taskCode,
      promptId: pteAttempts.promptId,
      examVersionId: pteAttempts.examVersionId,
      mode: pteAttempts.mode,
      score: pteAttempts.score,
      maxScore: pteAttempts.maxScore,
      timedOut: pteAttempts.timedOut,
      durationMs: pteAttempts.durationMs,
      snapshot: pteAttempts.snapshot,
      createdAt: pteAttempts.createdAt,
    })
    .from(pteAttempts)
    .where(taskCode ? and(eq(pteAttempts.userId, userId), eq(pteAttempts.taskCode, taskCode)) : eq(pteAttempts.userId, userId))
    .orderBy(desc(pteAttempts.createdAt))
    .limit(limit);
}

/** One attempt, rendered from its own snapshot (not from today's prompt or version). */
export async function getAttempt(db: DbExecutor, userId: string, id: string) {
  const [a] = await db
    .select()
    .from(pteAttempts)
    .where(and(eq(pteAttempts.id, id), eq(pteAttempts.userId, userId)));
  if (!a) throw new PteNotFoundError(id);
  const [version] = await db.select().from(examVersions).where(eq(examVersions.id, a.examVersionId));
  return { attempt: a, version: version! };
}

export async function getRubric(db: DbExecutor, versionId: string, taskCode: string) {
  const [r] = await db
    .select()
    .from(pteRubrics)
    .where(and(eq(pteRubrics.examVersionId, versionId), eq(pteRubrics.taskCode, taskCode)));
  return r ?? null;
}
