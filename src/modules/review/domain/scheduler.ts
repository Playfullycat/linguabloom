import { DefaultScheduler } from "ts-fsrs";

/**
 * FSRS scheduling (spec §2.3) via ts-fsrs v6. The algorithm itself is not
 * re-implemented; this module fixes one configuration and converts card state
 * to/from JSON for storage.
 *
 * Fuzz is off so a card's state can be rebuilt exactly by replaying its review
 * log ("FSRS 状态更新可复现"). Every card and log stores SCHEDULER_VERSION;
 * changing any setting below must change the version string.
 */
export const SCHEDULER_CONFIG = {
  version: "FSRS-7",
  desiredRetention: 0.9,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  enableFuzz: false,
  maximumInterval: 36_500,
} as const;

export const SCHEDULER_VERSION = "ts-fsrs@6.0.0;FSRS-7;r0.9;ls1m,10m;rs10m;nofuzz;max36500";

function createScheduler() {
  return DefaultScheduler({
    ...SCHEDULER_CONFIG,
    learningSteps: [...SCHEDULER_CONFIG.learningSteps],
    relearningSteps: [...SCHEDULER_CONFIG.relearningSteps],
  });
}

/** Inferred from the FSRS-7 configuration above (other model versions have different card shapes). */
type Scheduler = Awaited<ReturnType<typeof createScheduler>>;
/** The card shape `scheduler.review()` accepts (and returns). */
export type FsrsCard = Parameters<Scheduler["review"]>[0]["card"];
export type FsrsCardJson = Omit<FsrsCard, "dueAt" | "lastReviewAt"> & { dueAt: string; lastReviewAt: string | null };

let schedulerPromise: Promise<Scheduler> | undefined;

export function getScheduler(): Promise<Scheduler> {
  schedulerPromise ??= createScheduler();
  return schedulerPromise;
}

export function serializeCard(card: FsrsCard): FsrsCardJson {
  return JSON.parse(JSON.stringify(card)) as FsrsCardJson;
}

/** ts-fsrs requires real Date objects; JSON storage keeps ISO strings. */
export function reviveCard(json: FsrsCardJson): FsrsCard {
  return {
    ...json,
    dueAt: new Date(json.dueAt),
    lastReviewAt: json.lastReviewAt ? new Date(json.lastReviewAt) : null,
  } as unknown as FsrsCard;
}

export const FSRS_STATE = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

/** Lapses after which a card is flagged as difficult (spec §2.3). */
export const DIFFICULT_LAPSES = 4;
