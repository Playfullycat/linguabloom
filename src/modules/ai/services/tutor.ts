import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { aiMessages, aiSessions, userVocabulary, vocabularyEntries } from "@/db/schema";
import { getEnv } from "@/lib/config/env";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { addEntriesForUser } from "@/modules/review/services/vocabulary";

import { AIError } from "../provider/errors";
import type { AIProvider, ChatMessage } from "../provider/types";
import { buildTutorContext } from "../tutor/context";
import { TUTOR_MODE_INFO, buildSystemPrompt, type RoleplayScene, type TutorContext, type TutorMode } from "../tutor/prompts";
import { parseTutorReply, type TutorReply } from "../tutor/schema";
import { runAI } from "./usage";

/**
 * AI Tutor (spec §5.9). Teaching modes return a validated structured reply;
 * conversation and roleplay stream natural text. Conversations are stored
 * only when the learner allows it (Settings), and can be deleted.
 */

export class TutorSessionNotFoundError extends Error {}

export const HISTORY_LIMIT = 12;
export const MESSAGE_CHARS = 2000;

export type TutorRequest = {
  mode: TutorMode;
  message: string;
  /** Earlier turns, used when the conversation isn't stored on the server. */
  history: ChatMessage[];
  sessionId: string | null;
  scene?: RoleplayScene;
  material?: { contentId: string; seq: number | null };
  /** Inline check of one sentence: not stored as a conversation. */
  check?: boolean;
};

const trimHistory = (h: ChatMessage[]) => h.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content.slice(0, MESSAGE_CHARS) }));

async function ownedSession(db: DbExecutor, userId: string, sessionId: string) {
  const [s] = await db
    .select()
    .from(aiSessions)
    .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.userId, userId)));
  if (!s) throw new TutorSessionNotFoundError(sessionId);
  return s;
}

/** Stored turns win over what the browser sends (they can't be tampered with). */
async function historyFor(db: DbExecutor, userId: string, req: TutorRequest): Promise<ChatMessage[]> {
  if (!req.sessionId) return trimHistory(req.history);
  await ownedSession(db, userId, req.sessionId);
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.sessionId, req.sessionId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(HISTORY_LIMIT);
  return trimHistory(rows.reverse() as ChatMessage[]);
}

async function prepare(db: DbExecutor, userId: string, req: TutorRequest) {
  const [{ profile, preferences }, context, history] = await Promise.all([
    getLearnerSettings(db, userId),
    buildTutorContext(db, userId, req.mode, req.material),
    historyFor(db, userId, req),
  ]);
  const message = req.message.trim().slice(0, MESSAGE_CHARS);
  if (!message) throw new AIError("unknown", "empty message");
  return {
    timeZone: profile.timezone,
    save: preferences.saveAiConversations,
    context,
    system: buildSystemPrompt(req.mode, context, req.scene),
    messages: [...history, { role: "user" as const, content: message }],
    message,
  };
}

/** What was shared with the AI, stored with the session for transparency (no message text). */
const sharedContext = (mode: TutorMode, ctx: TutorContext, scene?: RoleplayScene) => ({
  mode,
  scene: scene ?? null,
  level: ctx.level,
  levelBasis: ctx.levelBasis,
  explanationLanguage: ctx.explanationLanguage,
  recentWords: ctx.recentWords.length,
  weakSpots: ctx.weakSpots.length,
  material: ctx.material?.title ?? null,
});

async function persist(
  db: Database,
  userId: string,
  req: TutorRequest,
  p: Awaited<ReturnType<typeof prepare>>,
  provider: AIProvider,
  reply: { text: string; metadata: TutorReply | null },
  costUsd: number | null,
) {
  if (!p.save || req.check) return null;
  return db.transaction(async (tx) => {
    let sessionId = req.sessionId;
    if (!sessionId) {
      const [s] = await tx
        .insert(aiSessions)
        .values({
          userId,
          provider: provider.name,
          model: provider.textModel,
          sessionType: req.mode,
          title: p.message.slice(0, 60),
          learningContext: sharedContext(req.mode, p.context, req.scene),
        })
        .returning({ id: aiSessions.id });
      sessionId = s!.id;
    }
    // Explicit times: now() is the same for the whole transaction, which would make the order of the two turns arbitrary.
    const at = Date.now();
    await tx.insert(aiMessages).values([
      { sessionId, role: "user", content: p.message, createdAt: new Date(at) },
      { sessionId, role: "assistant", content: reply.text, metadata: reply.metadata, createdAt: new Date(at + 1) },
    ]);
    await tx
      .update(aiSessions)
      .set({ estimatedCost: sql`coalesce(${aiSessions.estimatedCost}, 0) + ${costUsd ?? 0}` })
      .where(eq(aiSessions.id, sessionId));
    return sessionId;
  });
}

export type TutorResult = { reply: TutorReply; sessionId: string | null; level: string; levelBasis: string; simulated: boolean };

/** Teaching modes: one validated structured reply. */
export async function tutorReply(db: Database, userId: string, req: TutorRequest, provider?: AIProvider | null): Promise<TutorResult> {
  if (!TUTOR_MODE_INFO[req.mode].structured) throw new AIError("unknown", "mode streams text");
  const p = await prepare(db, userId, req);
  const env = getEnv();
  const { value, costUsd, provider: used } = await runAI({ db, userId, task: "tutor_structured", timeZone: p.timeZone, provider }, async (ai) => {
    const result = await ai.generateText({ task: "tutor_structured", system: p.system, messages: p.messages, json: true, maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS });
    return { value: parseTutorReply(result.text), usage: result.usage, model: result.model };
  });
  const sessionId = await persist(db, userId, req, p, used, { text: value.response_text, metadata: value }, costUsd);
  return { reply: value, sessionId, level: p.context.level, levelBasis: p.context.levelBasis, simulated: used.name === "mock" };
}

/**
 * Conversation and roleplay: stream natural text. The returned iterator
 * yields text deltas; the conversation is stored (if allowed) when it ends.
 */
export async function tutorStream(db: Database, userId: string, req: TutorRequest, signal?: AbortSignal, provider?: AIProvider | null) {
  if (TUTOR_MODE_INFO[req.mode].structured) throw new AIError("unknown", "mode returns structured replies");
  const p = await prepare(db, userId, req);
  const env = getEnv();
  let full = "";
  let resolveSession: (id: string | null) => void = () => undefined;
  const sessionReady = new Promise<string | null>((r) => (resolveSession = r));
  const chunks: string[] = [];
  let notify: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;

  // Run the provider stream inside runAI so usage and budget are recorded like any other call.
  const work = runAI({ db, userId, task: "tutor_chat", timeZone: p.timeZone, provider }, async (ai) => {
    let usage = { inputTokens: 0, outputTokens: 0 };
    let model = ai.textModel;
    for await (const part of ai.streamText({ task: "tutor_chat", system: p.system, messages: p.messages, maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS, signal })) {
      if (part.type === "delta") {
        full += part.text;
        chunks.push(part.text);
        notify?.();
      } else {
        usage = part.usage;
        model = part.model;
      }
    }
    if (!full.trim()) throw new AIError("invalid_response", "empty stream");
    return { value: full, usage, model };
  })
    .then(async ({ costUsd, provider: used }) => resolveSession(await persist(db, userId, req, p, used, { text: full.slice(0, 8000), metadata: null }, costUsd)))
    .catch((error: unknown) => {
      failure = error;
      resolveSession(null);
    })
    .finally(() => {
      finished = true;
      notify?.();
    });

  async function* deltas() {
    for (;;) {
      while (chunks.length > 0) yield chunks.shift()!;
      if (finished) break;
      await new Promise<void>((r) => (notify = r));
      notify = null;
    }
    await work;
    if (failure) throw failure;
  }
  return { deltas: deltas(), session: sessionReady, level: p.context.level, levelBasis: p.context.levelBasis };
}

// ---------------------------------------------------------------- history ----

export async function listTutorSessions(db: DbExecutor, userId: string) {
  return db
    .select({ id: aiSessions.id, title: aiSessions.title, mode: aiSessions.sessionType, startedAt: aiSessions.startedAt, // Written out: Drizzle leaves the outer column unqualified inside a raw subquery.
      messages: sql<number>`(select count(*)::int from ai_messages m where m.session_id = "ai_sessions"."id")` })
    .from(aiSessions)
    .where(eq(aiSessions.userId, userId))
    .orderBy(desc(aiSessions.startedAt))
    .limit(50);
}

export async function getTutorSession(db: DbExecutor, userId: string, sessionId: string) {
  const session = await ownedSession(db, userId, sessionId);
  const messages = await db.select().from(aiMessages).where(eq(aiMessages.sessionId, sessionId)).orderBy(asc(aiMessages.createdAt));
  return { session, messages: messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, reply: (m.metadata as TutorReply | null) ?? null })) };
}

export async function deleteTutorSession(db: DbExecutor, userId: string, sessionId: string) {
  const deleted = await db
    .delete(aiSessions)
    .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.userId, userId)))
    .returning({ id: aiSessions.id });
  if (deleted.length === 0) throw new TutorSessionNotFoundError(sessionId);
}

export async function deleteAllTutorSessions(db: DbExecutor, userId: string) {
  const deleted = await db.delete(aiSessions).where(eq(aiSessions.userId, userId)).returning({ id: aiSessions.id });
  return deleted.length;
}

/** A word the tutor suggested → the learner's own vocabulary entry with review cards. */
export async function addTutorWord(db: Database, userId: string, word: { text: string; zh: string; example: string | null }) {
  const text = word.text.trim().slice(0, 60);
  const [existing] = await db
    .select({ id: vocabularyEntries.id })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(and(eq(userVocabulary.userId, userId), sql`lower(${vocabularyEntries.text}) = ${text.toLowerCase()}`))
    .limit(1);
  if (existing) return { added: false };
  const id = `user.${randomUUID()}`;
  const example = word.example?.trim().slice(0, 240) ?? "";
  await db.insert(vocabularyEntries).values({
    id,
    unitId: null,
    key: text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "word",
    text,
    partOfSpeech: "",
    ipa: null,
    definitionZh: word.zh.trim().slice(0, 200),
    exampleEn: example,
    exampleZh: "",
    cefrLevel: "a1",
    sourceType: "ai_suggestion",
    ownerUserId: userId,
  });
  return { added: (await addEntriesForUser(db, userId, [id], "ai:tutor")) > 0 };
}
