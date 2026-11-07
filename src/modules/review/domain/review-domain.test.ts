// @vitest-environment node
import { describe, expect, it } from "vitest";

import { Rating } from "ts-fsrs";

import {
  RATING,
  answerVariants,
  availableCardTypes,
  buildCloze,
  enforceRating,
  isTypedAnswerCorrect,
  spokenText,
} from "./cards";
import { FSRS_STATE, getScheduler, reviveCard, serializeCard } from "./scheduler";
import { deriveVocabularyStatus, type CardSnapshot } from "./status";

const thanks = { text: "Thank you. / Thanks.", exampleEn: "Thanks, Tom!" };
const myName = { text: "My name's ...", exampleEn: "My name's Lin." };
const morning = { text: "Good morning", exampleEn: "Good morning, everyone." };
const zero = { text: "zero / oh", exampleEn: "My number starts with oh-one." };

describe("answer variants and checking", () => {
  it("splits alternatives and drops placeholders", () => {
    expect(answerVariants(thanks.text)).toEqual(["Thank you.", "Thanks."]);
    expect(answerVariants(myName.text)).toEqual(["My name's"]);
    expect(spokenText(myName.text)).toBe("My name's");
  });

  it("accepts any variant, leniently", () => {
    expect(isTypedAnswerCorrect(thanks, "recall", "thanks")).toBe(true);
    expect(isTypedAnswerCorrect(thanks, "recall", "Thank you")).toBe(true);
    expect(isTypedAnswerCorrect(morning, "spelling", "good morning!")).toBe(true);
    expect(isTypedAnswerCorrect(morning, "recall", "good evening")).toBe(false);
    expect(isTypedAnswerCorrect(morning, "recall", "")).toBe(false);
  });

  it("builds cloze sentences only when the chunk appears in the example", () => {
    expect(buildCloze(morning)).toEqual({ sentence: "___, everyone.", answer: "Good morning" });
    expect(buildCloze(myName)).toEqual({ sentence: "___ Lin.", answer: "My name's" });
    expect(buildCloze({ text: "teacher", exampleEn: "I'm a doctor." })).toBeNull();
    expect(availableCardTypes({ text: "teacher", exampleEn: "I'm a doctor." })).not.toContain("cloze");
    expect(isTypedAnswerCorrect(morning, "cloze", "good morning")).toBe(true);
    expect(isTypedAnswerCorrect(zero, "cloze", "oh")).toBe(true);
  });
});

describe("enforceRating (answer → reliable rating)", () => {
  it("keeps self-rated cards as rated", () => {
    expect(enforceRating({ cardType: "recognition", requested: RATING.Easy, answerCorrect: null, overridden: false, hintUsed: false })).toBe(4);
  });

  it("turns a wrong typed answer into Again unless the learner overrides it", () => {
    expect(enforceRating({ cardType: "recall", requested: RATING.Good, answerCorrect: false, overridden: false, hintUsed: false })).toBe(1);
    expect(enforceRating({ cardType: "recall", requested: RATING.Good, answerCorrect: false, overridden: true, hintUsed: false })).toBe(3);
  });

  it("caps hinted answers at Hard", () => {
    expect(enforceRating({ cardType: "spelling", requested: RATING.Easy, answerCorrect: true, overridden: false, hintUsed: true })).toBe(2);
  });
});

describe("scheduler (ts-fsrs v6)", () => {
  it("round-trips card state through JSON and stays deterministic", async () => {
    const scheduler = await getScheduler();
    const t0 = new Date("2026-11-07T00:00:00Z");
    const play = () => {
      let card = scheduler.newCard({ now: t0, cardId: "c1" });
      const steps: [number, number][] = [
        [Rating.Again, 0],
        [Rating.Good, 2],
        [Rating.Good, 15],
        [Rating.Good, 60 * 24 * 2],
      ];
      for (const [grade, minutes] of steps) {
        const revived = reviveCard(serializeCard(card));
        card = scheduler.review({ card: revived, grade: grade as 1, now: new Date(t0.getTime() + minutes * 60_000) }).card;
      }
      return serializeCard(card);
    };
    const a = play();
    expect(a).toEqual(play());
    expect(a.state).toBe(FSRS_STATE.Review);
    expect(new Date(a.dueAt).getTime()).toBeGreaterThan(t0.getTime());
  });
});

describe("deriveVocabularyStatus", () => {
  const card = (over: Partial<CardSnapshot>): CardSnapshot => ({
    cardType: "recognition",
    state: 0,
    reps: 0,
    stability: 0,
    suspended: false,
    difficult: false,
    ...over,
  });

  it("follows new → learning → receptive → productive", () => {
    expect(deriveVocabularyStatus([card({}), card({ cardType: "recall" })]).status).toBe("new");
    expect(deriveVocabularyStatus([card({ state: 1, reps: 1 }), card({ cardType: "recall" })]).status).toBe("learning");
    expect(deriveVocabularyStatus([card({ state: 2, reps: 3, stability: 8 }), card({ cardType: "recall" })]).status).toBe("receptive_known");
    expect(
      deriveVocabularyStatus([card({ state: 2, reps: 3, stability: 8 }), card({ cardType: "recall", state: 1, reps: 1, stability: 1 })]).status,
    ).toBe("productive_developing");
    expect(deriveVocabularyStatus([card({ state: 2, reps: 5, stability: 30 }), card({ cardType: "recall", state: 2, reps: 4, stability: 25 })]).status).toBe(
      "productive_known",
    );
  });

  it("flags difficult and suspended words, and computes mastery", () => {
    expect(deriveVocabularyStatus([card({ difficult: true, reps: 6, state: 3 })]).status).toBe("difficult");
    expect(deriveVocabularyStatus([card({ suspended: true })]).status).toBe("suspended");
    const result = deriveVocabularyStatus([card({ state: 2, reps: 3, stability: 3.5 }), card({ cardType: "recall", state: 2, reps: 2, stability: 21 })]);
    expect(result.receptiveMastery).toBeCloseTo(0.5);
    expect(result.productiveMastery).toBe(1);
  });
});
