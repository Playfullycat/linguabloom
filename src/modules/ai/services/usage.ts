import { and, eq, gte, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { aiUsage } from "@/db/schema";
import { getEnv, type Env } from "@/lib/config/env";
import { startOfLocalDay } from "@/lib/time";

import { getAIProvider } from "../provider";
import { AIError } from "../provider/errors";
import type { AIProvider, AITask, TokenUsage } from "../provider/types";

/**
 * Every AI call goes through `runAI`: availability, soft monthly budget and
 * a per-learner rate limit are checked first, and the outcome is recorded
 * (provider, model, task, tokens, estimated cost, latency — never the key or
 * the text). Spec §7.6 cost control.
 */

export const BUDGET_WARN_SHARE = 0.8;
const RATE_LIMIT = { requests: 20, windowMs: 60_000 };

export function estimateCost(usage: TokenUsage, env: Env = getEnv()): number | null {
  const pin = env.AI_TEXT_PRICE_INPUT_PER_1M;
  const pout = env.AI_TEXT_PRICE_OUTPUT_PER_1M;
  if (pin === undefined || pout === undefined) return null;
  return Math.round(((usage.inputTokens * pin + usage.outputTokens * pout) / 1_000_000) * 1e6) / 1e6;
}

/** First instant of the learner's local month. */
export function startOfLocalMonth(now: Date, timeZone: string): Date {
  const day = Number(new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric" }).format(now));
  let start = startOfLocalDay(now, timeZone);
  for (let i = 1; i < day; i += 1) start = startOfLocalDay(new Date(start.getTime() - 3_600_000), timeZone);
  return start;
}

export type BudgetState = {
  budget: number;
  spent: number;
  /** False when some requests have no price (cost can't be fully estimated). */
  costKnown: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  share: number | null;
  level: "ok" | "warn" | "exceeded" | "off";
};

export async function budgetState(db: DbExecutor, userId: string, now: Date, timeZone: string, env: Env = getEnv()): Promise<BudgetState> {
  const [row] = await db
    .select({
      requests: sql<number>`count(*) filter (where ${aiUsage.status} = 'ok')::int`,
      spent: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
      unpriced: sql<number>`count(*) filter (where ${aiUsage.status} = 'ok' and ${aiUsage.costUsd} is null and ${aiUsage.provider} <> 'mock')::int`,
      input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startOfLocalMonth(now, timeZone))));
  const budget = env.AI_MONTHLY_BUDGET;
  const spent = row?.spent ?? 0;
  const share = budget > 0 ? spent / budget : null;
  return {
    budget,
    spent,
    costKnown: (row?.unpriced ?? 0) === 0,
    requests: row?.requests ?? 0,
    inputTokens: row?.input ?? 0,
    outputTokens: row?.output ?? 0,
    share,
    level: share === null ? "off" : share >= 1 ? "exceeded" : share >= BUDGET_WARN_SHARE ? "warn" : "ok",
  };
}

const recent = new Map<string, number[]>();

/** In-memory sliding window per learner (single-process app). */
export function checkRateLimit(userId: string, now = Date.now()) {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (list.length >= RATE_LIMIT.requests) throw new AIError("rate_limited", "local limit");
  list.push(now);
  recent.set(userId, list);
}

export function resetRateLimit() {
  recent.clear();
}

async function record(db: DbExecutor, row: typeof aiUsage.$inferInsert) {
  await db.insert(aiUsage).values(row);
}

export type RunContext = { db: DbExecutor; userId: string; task: AITask; timeZone: string; now?: Date; env?: Env; provider?: AIProvider | null };

/** Check, call, record. `fn` returns its value plus token usage. */
export async function runAI<T>(ctx: RunContext, fn: (provider: AIProvider) => Promise<{ value: T; usage: TokenUsage; model: string }>): Promise<{ value: T; costUsd: number | null; provider: AIProvider }> {
  const env = ctx.env ?? getEnv();
  const provider = ctx.provider === undefined ? getAIProvider(env) : ctx.provider;
  if (!provider) throw new AIError("not_configured");
  const now = ctx.now ?? new Date();
  const started = Date.now();
  const base = { userId: ctx.userId, provider: provider.name, model: provider.textModel, task: ctx.task };

  const budget = await budgetState(ctx.db, ctx.userId, now, ctx.timeZone, env);
  if (budget.level === "exceeded") {
    await record(ctx.db, { ...base, latencyMs: 0, status: "blocked", errorCode: "budget_exceeded" });
    throw new AIError("budget_exceeded");
  }
  try {
    checkRateLimit(ctx.userId);
  } catch (error) {
    await record(ctx.db, { ...base, latencyMs: 0, status: "blocked", errorCode: "rate_limited" });
    throw error;
  }

  try {
    const { value, usage, model } = await fn(provider);
    const costUsd = provider.name === "mock" ? 0 : estimateCost(usage, env);
    await record(ctx.db, { ...base, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd, latencyMs: Date.now() - started, status: "ok" });
    return { value, costUsd, provider };
  } catch (error) {
    const aiError = error instanceof AIError ? error : new AIError("unknown", error instanceof Error ? error.name : undefined);
    await record(ctx.db, { ...base, latencyMs: Date.now() - started, status: "error", errorCode: aiError.code });
    throw aiError;
  }
}
