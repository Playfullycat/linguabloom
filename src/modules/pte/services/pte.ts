import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { examVersions, pteAttempts, ptePrompts, pteRubrics, pteTaskTypes, type ErrorCategory } from "@/db/schema";
import { getEnv, type Env } from "@/lib/config/env";
import { AIError } from "@/modules/ai/provider/errors";
import type { AIProvider } from "@/modules/ai/provider/types";
import { runAI } from "@/modules/ai/services/usage";
import { recordError } from "@/modules/errors/services/errors";
import { getLearnerSettings } from "@/modules/learner/services/profile";

import { WRITTEN_CODES, audioScript, isSpoken, learnerView, loadPte, type LearnerView, type PracticeTaskCode, type Prompt, type TaskCode } from "../content";
import { parsePteWrittenFeedback, pteFeedbackPrompt, type PteWrittenFeedback } from "../domain/feedback";
import { essayForm, scoreObjective, sstForm, swtForm, type FormCheck, type ItemMark, type Response } from "../domain/scoring";

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
  /** Timed mode: total time for reading/listening/writing items (official where it exists). */
  timeLimitSeconds: number;
  /** True when the limit is the official one; otherwise it's a practice suggestion. */
  officialTime: boolean;
  /** Spoken items: preparation and recording time (official, or a labelled suggestion). */
  speaking: { prepSeconds: number; responseSeconds: number; officialResponse: boolean } | null;
};

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : Array.isArray(v) && typeof v[0] === "number" ? Math.round(((v[0] as number) + ((v[1] as number) ?? v[0])) / 2) : fallback);

/** Official time (SST 10 min, SWT 10 min, essay 20 min, speaking prep + response) or this app's suggestion for timed practice. */
export function timeLimitFor(type: TaskTypeRow) {
  if (isSpoken(type.code)) {
    const t = type.timing;
    const response = num(t.response_seconds ?? t.suggested_response_seconds, 40);
    return { official: t.response_seconds !== undefined, seconds: num(t.prep_seconds, 0) + response };
  }
  const official = typeof type.timing.response_minutes === "number";
  return { official, seconds: official ? Math.round(type.timing.response_minutes! * 60) : (type.timing.suggested_seconds ?? 120) };
}

function speakingTiming(type: TaskTypeRow): PracticeItem["speaking"] {
  if (!isSpoken(type.code)) return null;
  const t = type.timing;
  return { prepSeconds: num(t.prep_seconds, 0), responseSeconds: num(t.response_seconds ?? t.suggested_response_seconds, 40), officialResponse: t.response_seconds !== undefined };
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
    speaking: speakingTiming(type),
  };
}

/** The words the audio says — for speech synthesis, and for browser speech when no speech model is configured. */
export function getAudioScript(promptId: string): string {
  const s = audioScript(promptFromContent(promptId));
  if (!s) throw new PteNotFoundError(promptId);
  return s;
}

/** The text a read-aloud / repeat answer is compared with (the mock transcriber uses it to simulate a transcript). */
export function expectedSpeech(promptId: string): string | undefined {
  const p = promptFromContent(promptId);
  return p.task === "sw_read_aloud" ? p.content.text : p.task === "sw_repeat_sentence" ? p.content.sentence : undefined;
}

/** After answering: the key, the explanation and the transcript. */
export type Reveal = {
  explanationZh: string | null;
  transcript: string | null;
  modelAnswer: string | null;
  keyPointsZh: string[];
};

function reveal(p: Prompt): Reveal {
  const c = p.content as { explanation_zh?: string; model_summary?: string; model_answer?: string; key_points_zh?: string[]; key_features_zh?: string[]; ideas_zh?: string[] };
  return {
    explanationZh: c.explanation_zh ?? null,
    transcript: audioScript(p),
    modelAnswer: c.model_summary ?? c.model_answer ?? (p.task === "l_wfd" ? p.content.sentence : null),
    keyPointsZh: c.key_points_zh ?? c.key_features_zh ?? c.ideas_zh ?? [],
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
  sw_answer_short_question: "comprehension",
};

/** Tasks that get AI-assisted feedback (comments, never a score). */
const AI_FEEDBACK: readonly string[] = ["l_sst", "sw_describe_image", "sw_retell_lecture", "sw_summarize_group_discussion", "sw_respond_situation", "sw_summarize_written_text", "sw_write_essay"];

/** What the feedback model is given as the source of the task. */
function feedbackSource(p: Prompt): { label: string; text: string; keyPointsZh: string[]; registerZh?: string } {
  switch (p.task) {
    case "sw_describe_image": {
      const c = p.content.chart;
      return { label: "CHART DATA", text: `${c.type} chart "${c.title}" (${c.y_label}):\n${c.categories.map((k, i) => `${k}: ${c.values[i]}${c.unit}`).join("\n")}`, keyPointsZh: p.content.key_features_zh };
    }
    case "sw_respond_situation":
      return { label: "SITUATION", text: p.content.situation, keyPointsZh: p.content.key_points_zh, registerZh: p.content.register_zh };
    case "sw_summarize_written_text":
      return { label: "PASSAGE", text: p.content.passage, keyPointsZh: p.content.key_points_zh };
    case "sw_write_essay":
      return { label: "ESSAY TOPIC", text: p.content.topic, keyPointsZh: p.content.ideas_zh };
    case "l_sst":
    case "sw_retell_lecture":
    case "sw_summarize_group_discussion":
      return { label: "RECORDING TRANSCRIPT", text: audioScript(p)!, keyPointsZh: p.content.key_points_zh };
    default:
      return { label: "SOURCE", text: "", keyPointsZh: [] };
  }
}

function formFor(p: Prompt, text: string): FormCheck | null {
  if (p.task === "l_sst") return sstForm(text);
  if (p.task === "sw_summarize_written_text") return swtForm(text);
  if (p.task === "sw_write_essay") return essayForm(text);
  return null;
}

export type SubmitInput = {
  promptId: string;
  response: Response;
  mode: "practice" | "timed" | "mock";
  durationMs: number;
  timedOut: boolean;
  clientRequestId: string;
  mockTestId?: string;
};

export type SubmitResult = {
  attemptId: string;
  score: number | null;
  maxScore: number | null;
  marks: ItemMark[];
  form: FormCheck | null;
  /** The transcript of a spoken answer (what the scoring and feedback were based on). */
  transcript: string | null;
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
    const detail = (existing.scoreDetail as { marks?: ItemMark[]; form?: FormCheck } | null) ?? {};
    const r = existing.response as Response;
    return {
      attemptId: existing.id,
      score: existing.score,
      maxScore: existing.maxScore,
      marks: detail.marks ?? [],
      form: detail.form ?? null,
      transcript: r.kind === "spoken" ? r.transcript : null,
      feedback: existing.feedback as PteWrittenFeedback | null,
      feedbackError: null,
      reveal: reveal(prompt),
      duplicate: true,
    };
  }

  // Spoken tasks take a transcript; written tasks a text.
  const spoken = isSpoken(prompt.task);
  if (spoken && input.response.kind !== "spoken") throw new PteRejectedError("提交的答案格式不正确。");
  if ((WRITTEN_CODES as readonly string[]).includes(prompt.task) && input.response.kind !== "text") throw new PteRejectedError("提交的答案格式不正确。");

  let objective: ReturnType<typeof scoreObjective>;
  try {
    objective = scoreObjective(prompt, input.response);
  } catch {
    throw new PteRejectedError("提交的答案格式不正确。");
  }

  const answerText = (input.response.kind === "text" ? input.response.text : input.response.kind === "spoken" ? input.response.transcript : "").trim().slice(0, 4000);
  const form = formFor(prompt, answerText);
  let feedback: PteWrittenFeedback | null = null;
  let feedbackError: string | null = null;
  if (AI_FEEDBACK.includes(prompt.task) && answerText) {
    try {
      const { profile } = await getLearnerSettings(db, userId);
      const explanation = (["zh", "mixed", "en"].includes(profile.explanationLanguage) ? profile.explanationLanguage : "zh") as "zh" | "mixed" | "en";
      const src = feedbackSource(prompt);
      const { value } = await runAI({ db, userId, task: "pte_feedback", timeZone: profile.timezone, provider, env }, async (ai) => {
        const r = await ai.generateText({
          task: "pte_feedback",
          system: pteFeedbackPrompt(prompt.task, { keyPointsZh: src.keyPointsZh, registerZh: src.registerZh, explanation, spoken }),
          messages: [{ role: "user", content: `${src.label}:\n${src.text}\n\nANSWER:\n${answerText}` }],
          json: true,
          maxOutputTokens: Math.max(env.AI_MAX_OUTPUT_TOKENS, prompt.task === "sw_write_essay" ? 1400 : 900),
        });
        return { value: parsePteWrittenFeedback(r.text, answerText, spoken), usage: r.usage, model: r.model };
      });
      feedback = value;
    } catch (error) {
      feedbackError = error instanceof AIError ? error.code : "unknown";
    }
  }

  const { seconds } = timeLimitFor(type);
  const [attempt] = await db
    .insert(pteAttempts)
    .values({
      userId,
      examVersionId: version.id,
      taskCode: prompt.task,
      promptId: row.id,
      promptVersion: row.contentVersion,
      mode: input.mode,
      mockTestId: input.mockTestId ?? null,
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
      timeLimitSeconds: input.mode === "practice" ? null : seconds,
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

  return {
    attemptId: attempt!.id,
    score: objective?.score ?? null,
    maxScore: objective?.maxScore ?? null,
    marks: objective?.marks ?? [],
    form,
    transcript: input.response.kind === "spoken" ? input.response.transcript : null,
    feedback,
    feedbackError,
    reveal: reveal(prompt),
    duplicate: false,
  };
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
