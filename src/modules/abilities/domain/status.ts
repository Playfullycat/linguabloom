import type { PassRule } from "../content";

/**
 * Status of one can-do statement from its evidence (spec §2.1: pass criteria,
 * confidence, last verification).
 *
 * - not_started: no evidence yet;
 * - emerging: some evidence, but the pass rule isn't met;
 * - shown: enough passing evidence (by weight) on enough different days, a
 *   good recent pass rate, and — for productive skills — at least one piece
 *   that is more than a self-rating.
 *
 * This is a learning record, not a certification, and it never changes a
 * CEFR level estimate by itself.
 */

export type EvidenceLike = { outcome: "pass" | "fail"; confidence: "low" | "medium" | "high"; weight: number; occurredAt: Date };

export type CanDoStatus = "not_started" | "emerging" | "shown";

export type StatusResult = {
  status: CanDoStatus;
  evidenceCount: number;
  passWeight: number;
  passDays: number;
  /** Share of passes among the most recent pieces (null without evidence). */
  recentRate: number | null;
  lastVerifiedAt: Date | null;
  /** Shown, but nothing new for a long time: worth practising again. */
  stale: boolean;
  /** What is still missing, in plain words (empty when shown). */
  missing: string[];
};

export const RECENT_WINDOW = 10;
export const STALE_DAYS = 60;

export const CONFIDENCE_WEIGHT = { low: 0.5, medium: 1, high: 1 } as const;

export function canDoStatus(evidence: EvidenceLike[], rule: PassRule, timeZone: string, now = new Date()): StatusResult {
  if (evidence.length === 0) return { status: "not_started", evidenceCount: 0, passWeight: 0, passDays: 0, recentRate: null, lastVerifiedAt: null, stale: false, missing: [] };
  const sorted = [...evidence].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const passes = sorted.filter((e) => e.outcome === "pass");
  const passWeight = Math.round(passes.reduce((s, e) => s + e.weight, 0) * 10) / 10;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const passDays = new Set(passes.map((e) => day.format(e.occurredAt))).size;
  const recent = sorted.slice(0, RECENT_WINDOW);
  const recentRate = recent.filter((e) => e.outcome === "pass").length / recent.length;
  const hasMedium = passes.some((e) => e.confidence !== "low");
  const lastVerifiedAt = sorted[0]!.occurredAt;

  const missing: string[] = [];
  if (passWeight < rule.minWeight) missing.push(`还需要约 ${Math.ceil((rule.minWeight - passWeight) * 2) / 2} 次成功的练习`);
  if (passDays < rule.minDays) missing.push(`需要在至少 ${rule.minDays} 个不同的日子里做到`);
  if (recentRate < rule.minRate) missing.push(`最近的正确率要达到 ${Math.round(rule.minRate * 100)}%（现在 ${Math.round(recentRate * 100)}%）`);
  if (rule.needsMedium && !hasMedium) missing.push("还需要一次口语 / 写作任务的反馈或客观题，自评不算");

  const shown = missing.length === 0;
  const stale = shown && now.getTime() - lastVerifiedAt.getTime() > STALE_DAYS * 86_400_000;
  return { status: shown ? "shown" : "emerging", evidenceCount: evidence.length, passWeight, passDays, recentRate, lastVerifiedAt, stale, missing };
}

export const STATUS_LABELS: Record<CanDoStatus, string> = { not_started: "还没有证据", emerging: "有证据了", shown: "已展示" };
