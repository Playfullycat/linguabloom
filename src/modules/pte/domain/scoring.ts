import { hiwTokens, seededOrder, typedAnswers, words, type Prompt } from "../content";

/**
 * Objective PTE scoring (spec §5.13: objective items are scored exactly).
 * Rules follow the official descriptions (per blank / per word partial credit,
 * minus points for wrong choices in multiple-answer and highlight tasks); the
 * reorder "adjacent pairs" rule is this app's choice (see exam-versions.json).
 */

export type ItemMark = { label: string; correct: boolean; given: string | null; expected: string | null };
export type ObjectiveScore = { score: number; maxScore: number; marks: ItemMark[] };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Response =
  | { kind: "choices"; choices: (number | null)[] }
  | { kind: "selected"; selected: number[] }
  | { kind: "order"; order: string[] }
  | { kind: "words"; words: (string | null)[] }
  | { kind: "choice"; choice: number | null }
  | { kind: "text"; text: string };

export class ResponseShapeError extends Error {}

const need = <K extends Response["kind"]>(r: Response, kind: K): Extract<Response, { kind: K }> => {
  if (r.kind !== kind) throw new ResponseShapeError(`expected ${kind}`);
  return r as Extract<Response, { kind: K }>;
};

/** +1 for each correct option chosen, −1 for each wrong one, never below 0. */
export function scoreMultiple(selected: number[], answers: number[], options: string[]): ObjectiveScore {
  const chosen = new Set(selected.filter((i) => Number.isInteger(i) && i >= 0 && i < options.length));
  const right = new Set(answers);
  let raw = 0;
  const marks: ItemMark[] = options.map((o, i) => {
    const picked = chosen.has(i);
    const isAnswer = right.has(i);
    if (picked) raw += isAnswer ? 1 : -1;
    return { label: o, correct: picked === isAnswer, given: picked ? "选了" : null, expected: isAnswer ? "正确选项" : null };
  });
  return { score: Math.max(0, raw), maxScore: answers.length, marks };
}

/** One point for each pair of neighbouring items that is in the right order. */
export function scoreAdjacentPairs(learnerOrder: number[], n: number): ObjectiveScore {
  const marks: ItemMark[] = [];
  let score = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const a = learnerOrder[i];
    const b = learnerOrder[i + 1];
    const ok = a !== undefined && b !== undefined && b === a + 1;
    if (ok) score += 1;
    marks.push({ label: `第 ${i + 1}–${i + 2} 个位置`, correct: ok, given: null, expected: null });
  }
  return { score, maxScore: n - 1, marks };
}

/** One point for each word of the sentence that appears (correctly spelled) in the answer. */
export function scoreDictation(answer: string, sentence: string): ObjectiveScore {
  const expected = norm(sentence).split(" ").filter(Boolean);
  const pool = new Map<string, number>();
  for (const w of norm(answer).split(" ").filter(Boolean)) pool.set(w, (pool.get(w) ?? 0) + 1);
  let score = 0;
  const marks = expected.map((w) => {
    const left = pool.get(w) ?? 0;
    const ok = left > 0;
    if (ok) {
      score += 1;
      pool.set(w, left - 1);
    }
    return { label: w, correct: ok, given: null, expected: w };
  });
  return { score, maxScore: expected.length, marks };
}

/** Score any objective task. Throws ResponseShapeError for a response of the wrong shape. */
export function scoreObjective(p: Prompt, response: Response): ObjectiveScore | null {
  switch (p.task) {
    case "r_fib_dropdown": {
      const r = need(response, "choices");
      const marks = p.content.blanks.map((b, i) => {
        const c = r.choices[i];
        const given = c === null || c === undefined ? null : (b.options[c] ?? null);
        return { label: `第 ${i + 1} 空`, correct: c === b.answer, given, expected: b.options[b.answer]! };
      });
      return { score: marks.filter((m) => m.correct).length, maxScore: marks.length, marks };
    }
    case "r_fib_drag": {
      const r = need(response, "words");
      const marks = p.content.answers.map((a, i) => {
        const given = r.words[i] ?? null;
        return { label: `第 ${i + 1} 空`, correct: given === a, given, expected: a };
      });
      return { score: marks.filter((m) => m.correct).length, maxScore: marks.length, marks };
    }
    case "l_fib_type": {
      const r = need(response, "words");
      const marks = typedAnswers(p.content.transcript).map((alts, i) => {
        const given = (r.words[i] ?? "").trim();
        return { label: `第 ${i + 1} 空`, correct: alts.some((a) => a.toLowerCase() === given.toLowerCase()), given: given || null, expected: alts.join(" / ") };
      });
      return { score: marks.filter((m) => m.correct).length, maxScore: marks.length, marks };
    }
    case "r_mcma":
    case "l_mcma":
      return scoreMultiple(need(response, "selected").selected, p.content.answers, p.content.options);
    case "r_mcsa":
    case "l_mcsa":
    case "l_hcs":
    case "l_smw": {
      const c = need(response, "choice").choice;
      const ok = c === p.content.answer;
      return {
        score: ok ? 1 : 0,
        maxScore: 1,
        marks: [{ label: "答案", correct: ok, given: c === null || c === undefined ? null : (p.content.options[c] ?? null), expected: p.content.options[p.content.answer]! }],
      };
    }
    case "r_reorder": {
      const r = need(response, "order");
      // Display ids A, B, C … map back to the original positions through the same seeded shuffle.
      const display = seededOrder(p.content.items.length, p.id);
      const learner = r.order.map((id) => display[id.charCodeAt(0) - 65]).filter((x): x is number => x !== undefined);
      if (new Set(learner).size !== p.content.items.length || learner.length !== p.content.items.length) throw new ResponseShapeError("order must use every item once");
      return scoreAdjacentPairs(learner, p.content.items.length);
    }
    case "l_hiw": {
      const { tokens, incorrect } = hiwTokens(p.content.transcript);
      const selected = new Set(need(response, "selected").selected.filter((i) => tokens[i]?.word));
      const wrong = new Set(incorrect);
      let raw = 0;
      const marks: ItemMark[] = [];
      for (const i of new Set([...selected, ...wrong])) {
        const hit = selected.has(i) && wrong.has(i);
        if (selected.has(i)) raw += hit ? 1 : -1;
        marks.push({ label: tokens[i]!.text, correct: hit, given: selected.has(i) ? "选了" : null, expected: wrong.has(i) ? "和录音不同" : null });
      }
      return { score: Math.max(0, raw), maxScore: incorrect.length, marks };
    }
    case "l_wfd":
      return scoreDictation(need(response, "text").text, p.content.sentence);
    case "l_sst":
      return null;
  }
}

/** Summarize Spoken Text form check (official: 50–70 words; outside 40–100 scores zero). */
export function sstForm(text: string): { words: number; status: "ok" | "outside_target" | "zero" } {
  const n = words(text);
  return { words: n, status: n >= 50 && n <= 70 ? "ok" : n >= 40 && n <= 100 ? "outside_target" : "zero" };
}
