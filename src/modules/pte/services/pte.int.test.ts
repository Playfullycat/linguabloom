import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { errorOccurrences, examVersions, pteAttempts, ptePrompts, pteTaskTypes, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { pteSeed } from "@/db/seed/pte";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { MockProvider } from "@/modules/ai/provider/mock";
import { resetRateLimit } from "@/modules/ai/services/usage";
import { cachedSpeech } from "@/modules/audio/tts-cache";

import { PteNotFoundError, PteRejectedError, getAttempt, getAudioScript, getCurrentVersion, getPracticeItem, listAttempts, listPrompts, submitAttempt, taskStats } from "./pte";

const storage = mkdtempSync(path.join(tmpdir(), "lb-pte-"));
process.env.STORAGE_ROOT = storage;

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const mock = new MockProvider();
let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(pteAttempts);
  await db.delete(users);
  resetRateLimit();
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(async () => {
  await client.end();
  rmSync(storage, { recursive: true, force: true });
});

const submit = (user: string, promptId: string, response: Parameters<typeof submitAttempt>[2]["response"], extra: Partial<Parameters<typeof submitAttempt>[2]> = {}) =>
  submitAttempt(db, user, { promptId, response, mode: "practice", durationMs: 30_000, timedOut: false, clientRequestId: randomUUID(), ...extra }, mock);

describe("seeded PTE data", () => {
  it("has the current version, 22 task types and versioned prompts", async () => {
    const v = await getCurrentVersion(db);
    expect(v).toMatchObject({ id: "pte-academic-2025", effectiveFrom: null, isCurrent: true });
    expect(v.sources.length).toBeGreaterThan(3);
    expect(await db.select().from(pteTaskTypes).where(eq(pteTaskTypes.examVersionId, v.id))).toHaveLength(22);
    const [p] = await db.select().from(ptePrompts).where(eq(ptePrompts.id, "pte-r-mcsa-01"));
    expect(p!.contentVersion).toBe(1);
  });

  it("a changed prompt gets a new content version on the next seed", async () => {
    await db.update(ptePrompts).set({ contentHash: "old" }).where(eq(ptePrompts.id, "pte-r-mcsa-02"));
    await db.transaction((tx) => pteSeed.run(tx));
    const [p] = await db.select().from(ptePrompts).where(eq(ptePrompts.id, "pte-r-mcsa-02"));
    expect(p!.contentVersion).toBe(2);
    await db.transaction((tx) => pteSeed.run(tx));
    const [again] = await db.select().from(ptePrompts).where(eq(ptePrompts.id, "pte-r-mcsa-02"));
    expect(again!.contentVersion).toBe(2);
  });
});

describe("practice", () => {
  it("the practice item has no answers; the script is only available on request", async () => {
    const item = await getPracticeItem(db, "pte-l-mcsa-01");
    expect(item).toMatchObject({ taskCode: "l_mcsa", hasAudio: true, officialTime: false });
    expect(JSON.stringify(item)).not.toMatch(/answer|Monday at noon was|explanation/);
    expect(getAudioScript("pte-l-mcsa-01")).toContain("Monday at noon");
    expect((await getPracticeItem(db, "pte-l-sst-01"))).toMatchObject({ timeLimitSeconds: 600, officialTime: true });
    await expect(getPracticeItem(db, "pte-nope")).rejects.toThrow(PteNotFoundError);
    expect(() => getAudioScript("pte-r-mcsa-01")).toThrow(PteNotFoundError);
  });

  it("scores objectively, binds the attempt to the exam and prompt version, and keeps a snapshot", async () => {
    const r = await submit(userA, "pte-r-mcma-01", { kind: "selected", selected: [0, 1, 2] }, { mode: "timed" });
    expect(r).toMatchObject({ score: 1, maxScore: 3, duplicate: false });
    expect(r.reveal.explanationZh).toContain("注意力");
    const [row] = await db.select().from(pteAttempts).where(eq(pteAttempts.id, r.attemptId));
    expect(row).toMatchObject({ examVersionId: "pte-academic-2025", promptVersion: 1, mode: "timed", timeLimitSeconds: 150 });
    expect(row!.snapshot).toMatchObject({ taskNameZh: "阅读多选", scoringMethod: "mcma", promptTitleZh: "学一门乐器的好处" });

    // Lost points → error notebook, linked to the task type.
    const occ = await db.select().from(errorOccurrences).where(and(eq(errorOccurrences.userId, userA), eq(errorOccurrences.source, "pte")));
    expect(occ).toHaveLength(1);
    expect(occ[0]!.sourceRef).toBe(r.attemptId);
  });

  it("a retried request returns the stored attempt; bad shapes and other users' retries are refused", async () => {
    const clientRequestId = randomUUID();
    const first = await submit(userA, "pte-r-mcsa-01", { kind: "choice", choice: 1 }, { clientRequestId });
    const again = await submit(userA, "pte-r-mcsa-01", { kind: "choice", choice: 0 }, { clientRequestId });
    expect(again).toMatchObject({ attemptId: first.attemptId, score: 1, duplicate: true });
    await expect(submit(userB, "pte-r-mcsa-01", { kind: "choice", choice: 1 }, { clientRequestId })).rejects.toThrow(PteRejectedError);
    await expect(submit(userA, "pte-r-mcsa-01", { kind: "text", text: "1" })).rejects.toThrow(PteRejectedError);
    // A perfect answer leaves no error-notebook entry.
    expect(await db.select().from(errorOccurrences).where(eq(errorOccurrences.userId, userA))).toHaveLength(0);
  });

  it("summarize spoken text: program checks the form, AI gives feedback; an AI failure keeps the attempt", async () => {
    const summary = "The speaker explains that urban beekeeping is popular because cities have many different plants, so city bees can produce more honey than bees on farms with one crop and chemicals. However, too many hives may cause a shortage of flowers and competition with wild bees, so beekeeping must be balanced with planting flowers.";
    const r = await submit(userA, "pte-l-sst-01", { kind: "text", text: summary });
    expect(r.score).toBeNull();
    expect(r.form).toMatchObject({ status: "ok" });
    expect(r.feedback).toMatchObject({ confidence: "medium" });
    expect(r.reveal.keyPointsZh.length).toBeGreaterThan(1);

    const failed = await submit(userA, "pte-l-sst-01", { kind: "text", text: `${summary} [mock:error:timeout]` });
    expect(failed).toMatchObject({ feedback: null, feedbackError: "timeout" });
    expect(await db.select().from(pteAttempts).where(eq(pteAttempts.id, failed.attemptId))).toHaveLength(1);
  });

  it("history, stats and best scores are per learner", async () => {
    await submit(userA, "pte-l-wfd-01", { kind: "text", text: "The library will be closed on Sunday for repairs" });
    await submit(userA, "pte-l-wfd-01", { kind: "text", text: "The library closed Sunday" });
    expect((await listPrompts(db, userA, "l_wfd")).find((p) => p.id === "pte-l-wfd-01")).toMatchObject({ best: 1, attempts: 2 });
    expect((await taskStats(db, userA)).get("l_wfd")).toMatchObject({ attempts: 2 });
    expect(await listAttempts(db, userB)).toEqual([]);
    const [a] = await listAttempts(db, userA, "l_wfd");
    await expect(getAttempt(db, userB, a!.id)).rejects.toThrow(PteNotFoundError);
  });

  it("listening audio is generated once and cached as a file", async () => {
    const first = await cachedSpeech(db, userA, getAudioScript("pte-l-wfd-02"), {}, mock);
    expect(first.generated).toBe(true);
    expect(existsSync(path.join(storage, first.relativePath))).toBe(true);
    expect((await cachedSpeech(db, userA, getAudioScript("pte-l-wfd-02"), {}, mock)).generated).toBe(false);
  });
});

describe("a new exam version", () => {
  it("doesn't change old attempts; new attempts bind to the new version", async () => {
    const old = await submit(userA, "pte-r-fib-drag-01", { kind: "words", words: ["energy", "concentrate", "rely"] });
    // Simulate Pearson changing the format: a new current version with a renamed task.
    await db.update(examVersions).set({ isCurrent: false });
    await db.insert(examVersions).values({ id: "pte-academic-test-next", exam: "pte_academic", labelZh: "测试用的新版本", reviewedOn: "2027-01-01", sources: [], isCurrent: true });
    const types = await db.select().from(pteTaskTypes).where(eq(pteTaskTypes.examVersionId, "pte-academic-2025"));
    await db.insert(pteTaskTypes).values(types.map((t) => ({ ...t, examVersionId: "pte-academic-test-next", nameZh: t.code === "r_fib_drag" ? "阅读填空（新名字）" : t.nameZh })));
    try {
      const fresh = await submit(userA, "pte-r-fib-drag-01", { kind: "words", words: ["energy", "concentrate", "rely"] });
      const [row] = await db.select().from(pteAttempts).where(eq(pteAttempts.id, fresh.attemptId));
      expect(row).toMatchObject({ examVersionId: "pte-academic-test-next" });
      expect(row!.snapshot).toMatchObject({ taskNameZh: "阅读填空（新名字）" });

      const before = await getAttempt(db, userA, old.attemptId);
      expect(before.version.id).toBe("pte-academic-2025");
      expect(before.attempt.snapshot).toMatchObject({ taskNameZh: "阅读填空（拖放）" });
      expect(before.attempt).toMatchObject({ score: 3, maxScore: 3 });
    } finally {
      await db.delete(pteAttempts);
      await db.delete(pteTaskTypes).where(eq(pteTaskTypes.examVersionId, "pte-academic-test-next"));
      await db.delete(examVersions).where(eq(examVersions.id, "pte-academic-test-next"));
      await db.update(examVersions).set({ isCurrent: true }).where(eq(examVersions.id, "pte-academic-2025"));
    }
  });
});
