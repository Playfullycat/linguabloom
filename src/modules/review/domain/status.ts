import { CARD_TYPE_INFO, type ReviewCardType } from "./cards";
import { FSRS_STATE } from "./scheduler";

/**
 * Derive a word's learning status from its cards (spec §2.4): learners can
 * see what they recognise vs. what they can produce.
 */
export type CardSnapshot = {
  cardType: ReviewCardType;
  state: number;
  reps: number;
  stability: number;
  suspended: boolean;
  difficult: boolean;
};

export type VocabularyStatusValue =
  | "new"
  | "learning"
  | "receptive_known"
  | "productive_developing"
  | "productive_known"
  | "difficult"
  | "suspended";

/** Stability (days) at which knowledge counts as stable. */
export const RECEPTIVE_KNOWN_DAYS = 7;
export const PRODUCTIVE_KNOWN_DAYS = 21;

function mastery(cards: CardSnapshot[], targetDays: number): number {
  if (cards.length === 0) return 0;
  const best = Math.max(...cards.map((c) => (c.state === FSRS_STATE.New ? 0 : c.stability)));
  return Math.min(1, best / targetDays);
}

export function deriveVocabularyStatus(cards: CardSnapshot[]): {
  status: VocabularyStatusValue;
  receptiveMastery: number;
  productiveMastery: number;
} {
  const active = cards.filter((c) => !c.suspended);
  const receptive = active.filter((c) => CARD_TYPE_INFO[c.cardType].knowledge === "receptive");
  const productive = active.filter((c) => CARD_TYPE_INFO[c.cardType].knowledge === "productive");
  const receptiveMastery = mastery(receptive, RECEPTIVE_KNOWN_DAYS);
  const productiveMastery = mastery(productive, PRODUCTIVE_KNOWN_DAYS);

  const stableIn = (list: CardSnapshot[], days: number) =>
    list.some((c) => c.state === FSRS_STATE.Review && c.stability >= days);

  let status: VocabularyStatusValue;
  if (cards.length > 0 && active.length === 0) status = "suspended";
  else if (active.some((c) => c.difficult)) status = "difficult";
  else if (stableIn(productive, PRODUCTIVE_KNOWN_DAYS)) status = "productive_known";
  else if (stableIn(receptive, RECEPTIVE_KNOWN_DAYS) && productive.some((c) => c.reps > 0)) status = "productive_developing";
  else if (stableIn(receptive, RECEPTIVE_KNOWN_DAYS)) status = "receptive_known";
  else if (active.every((c) => c.reps === 0)) status = "new";
  else status = "learning";

  return { status, receptiveMastery, productiveMastery };
}

export const STATUS_LABELS: Record<VocabularyStatusValue, string> = {
  new: "新词",
  learning: "学习中",
  receptive_known: "看得懂",
  productive_developing: "正在学会用",
  productive_known: "会用了",
  difficult: "困难",
  suspended: "已暂停",
};
