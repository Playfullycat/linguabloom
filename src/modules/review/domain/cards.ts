import { normalizeAnswer } from "../../curriculum/domain/scoring";

/**
 * Card templates (spec §2.3, §5.4) and how answers turn into ratings.
 *
 * - recognition: see the English (and hear it) → recall the meaning (receptive, self-rated)
 * - listening:   only hear it → recall word + meaning (receptive, self-rated)
 * - recall:      see the meaning → type the English (productive, checked)
 * - spelling:    hear it → type it (productive, checked)
 * - cloze:       example sentence with a gap → type the missing chunk (productive, checked)
 */
export const CARD_TYPE_INFO = {
  recognition: { label: "英 → 义", mode: "self", knowledge: "receptive", description: "看到英文，说出意思" },
  listening: { label: "听音识别", mode: "self", knowledge: "receptive", description: "只听声音，说出是哪个词、什么意思" },
  recall: { label: "义 → 英", mode: "typed", knowledge: "productive", description: "看到中文，写出英文" },
  spelling: { label: "听写拼写", mode: "typed", knowledge: "productive", description: "听到声音，拼写出来" },
  cloze: { label: "语境填空", mode: "typed", knowledge: "productive", description: "在例句里填出这个词" },
} as const;

export type ReviewCardType = keyof typeof CARD_TYPE_INFO;

/** Created automatically when a word is added; the others are opt-in (spec: no card explosion). */
export const DEFAULT_CARD_TYPES: ReviewCardType[] = ["recognition", "recall"];

export function isTypedCard(type: ReviewCardType): boolean {
  return CARD_TYPE_INFO[type].mode === "typed";
}

export type EntryLike = { text: string; exampleEn: string };

/**
 * Accepted spellings for a word/chunk: "Thank you. / Thanks." → ["Thank you.", "Thanks."],
 * placeholders such as "..." are dropped ("My name's ..." → "My name's").
 */
export function answerVariants(text: string): string[] {
  return text
    .split(" / ")
    .map((v) => v.replace(/\.{3}|…/g, "").trim())
    .filter((v) => normalizeAnswer(v).length > 0);
}

/** What is spoken for listening/spelling cards (first variant, without placeholders). */
export function spokenText(text: string): string {
  return answerVariants(text)[0] ?? text;
}

export function isTypedAnswerCorrect(entry: EntryLike, type: ReviewCardType, typed: string): boolean {
  const given = normalizeAnswer(typed);
  if (!given) return false;
  if (type === "cloze") {
    const cloze = buildCloze(entry);
    return cloze !== null && normalizeAnswer(cloze.answer) === given;
  }
  return answerVariants(entry.text).some((v) => normalizeAnswer(v) === given);
}

/**
 * Gap the word inside its example sentence, if it appears there verbatim
 * (case-insensitive). Returns null when no clean gap is possible.
 */
export function buildCloze(entry: EntryLike): { sentence: string; answer: string } | null {
  for (const variant of answerVariants(entry.text)) {
    const core = variant.replace(/[.!?]+$/, "").trim();
    if (core.length < 2) continue;
    const index = entry.exampleEn.toLowerCase().indexOf(core.toLowerCase());
    if (index === -1) continue;
    const answer = entry.exampleEn.slice(index, index + core.length);
    return { sentence: `${entry.exampleEn.slice(0, index)}___${entry.exampleEn.slice(index + core.length)}`, answer };
  }
  return null;
}

export function availableCardTypes(entry: EntryLike): ReviewCardType[] {
  return (Object.keys(CARD_TYPE_INFO) as ReviewCardType[]).filter((t) => t !== "cloze" || buildCloze(entry) !== null);
}

export const RATING = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Grade = (typeof RATING)[keyof typeof RATING];

export const RATING_LABELS: Record<Grade, { zh: string; en: string; meaning: string }> = {
  1: { zh: "忘记了", en: "Again", meaning: "想不起来或答错了" },
  2: { zh: "很吃力", en: "Hard", meaning: "答对了，但很慢、不确定或用了提示" },
  3: { zh: "记得", en: "Good", meaning: "自己独立想起来了" },
  4: { zh: "很轻松", en: "Easy", meaning: "又快又稳" },
};

/**
 * Turn the learner's answer into a reliable rating (spec §2.3: the app maps
 * answers to ratings; FSRS does the scheduling). Enforced on the server.
 * - typed card answered wrong (and not overridden) → Again
 * - typed card answered right with a hint → at most Hard
 * - otherwise the learner's own rating
 */
export function enforceRating(input: {
  cardType: ReviewCardType;
  requested: Grade;
  answerCorrect: boolean | null;
  overridden: boolean;
  hintUsed: boolean;
}): Grade {
  if (!isTypedCard(input.cardType)) return input.requested;
  const correct = input.answerCorrect === true || input.overridden;
  if (!correct) return RATING.Again;
  if (input.requested === RATING.Again) return RATING.Again;
  if (input.hintUsed) return Math.min(input.requested, RATING.Hard) as Grade;
  return input.requested;
}
