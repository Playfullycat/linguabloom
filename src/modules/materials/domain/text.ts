import { normalizeAnswer } from "../../curriculum/domain/scoring";

/**
 * Text helpers for the reader and listening studio: split sentences into
 * clickable words, attach glossary entries (including multi-word chunks and
 * inflected forms), compute difficulty numbers and check dictation.
 */

export type GlossaryEntry = {
  key: string;
  text: string;
  /** Other forms that appear in the text, e.g. "gets", "got". */
  forms?: string[];
  pos: string;
  ipa?: string;
  zh: string;
  note_zh?: string;
};

export type Token =
  | { kind: "word"; text: string; gloss: string | null }
  | { kind: "space"; text: string };

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*/g;

const norm = (s: string) => s.toLowerCase().replace(/’/g, "'");

/** Words of a sentence, in order (letters, apostrophes, numbers). */
export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

type Form = { key: string; parts: string[] };

function glossaryForms(glossary: GlossaryEntry[]): Form[] {
  const forms: Form[] = [];
  for (const g of glossary) {
    for (const f of [g.text, ...(g.forms ?? [])]) {
      const parts = words(f).map(norm);
      if (parts.length > 0) forms.push({ key: g.key, parts });
    }
  }
  // Longest first, so "get up" wins over "get".
  return forms.sort((a, b) => b.parts.length - a.parts.length);
}

/**
 * Split a sentence into word and non-word tokens. A glossary chunk becomes
 * one word token ("get up"), so it can be tapped as a unit.
 */
export function tokenize(text: string, glossary: GlossaryEntry[]): Token[] {
  const matches = [...text.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  const forms = glossaryForms(glossary);
  const tokens: Token[] = [];
  let cursor = 0;
  let i = 0;
  while (i < matches.length) {
    let span = 1;
    let gloss: string | null = null;
    for (const f of forms) {
      if (i + f.parts.length > matches.length) continue;
      if (f.parts.every((p, k) => norm(matches[i + k]!.text) === p)) {
        span = f.parts.length;
        gloss = f.key;
        break;
      }
    }
    const first = matches[i]!;
    const last = matches[i + span - 1]!;
    if (first.start > cursor) tokens.push({ kind: "space", text: text.slice(cursor, first.start) });
    tokens.push({ kind: "word", text: text.slice(first.start, last.end), gloss });
    cursor = last.end;
    i += span;
  }
  if (cursor < text.length) tokens.push({ kind: "space", text: text.slice(cursor) });
  return tokens;
}

/** Whether `phrase` (word sequence) occurs in `text`. */
export function containsPhrase(text: string, phrase: string): boolean {
  const hay = words(text).map(norm);
  const needle = words(phrase).map(norm);
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((p, k) => hay[i + k] === p)) return true;
  }
  return false;
}

export type DifficultyMetadata = {
  wordCount: number;
  sentenceCount: number;
  averageSentenceLength: number;
  longestSentence: number;
  glossaryCount: number;
  /** Share of running words that are glossary (above-level) words. */
  glossaryDensity: number;
};

export function difficultyOf(segments: string[], glossary: GlossaryEntry[]): DifficultyMetadata {
  const lengths = segments.map((s) => words(s).length);
  const wordCount = lengths.reduce((a, b) => a + b, 0);
  let glossaryWords = 0;
  for (const s of segments) {
    for (const t of tokenize(s, glossary)) if (t.kind === "word" && t.gloss) glossaryWords += words(t.text).length;
  }
  return {
    wordCount,
    sentenceCount: segments.length,
    averageSentenceLength: segments.length === 0 ? 0 : Math.round((wordCount / segments.length) * 10) / 10,
    longestSentence: Math.max(0, ...lengths),
    glossaryCount: glossary.length,
    glossaryDensity: wordCount === 0 ? 0 : Math.round((glossaryWords / wordCount) * 1000) / 1000,
  };
}

export type DictationWord = { word: string; status: "ok" | "wrong" | "missing" };

/**
 * Compare a dictation attempt with the sentence, word by word (LCS), so the
 * learner sees exactly which words were missed. Case and punctuation are ignored.
 */
export function checkDictation(expected: string, given: string): { isCorrect: boolean; words: DictationWord[]; extra: string[] } {
  const exp = words(expected);
  const got = words(given);
  const e = exp.map((w) => normalizeAnswer(w));
  const g = got.map((w) => normalizeAnswer(w));
  const dp: number[][] = Array.from({ length: e.length + 1 }, () => Array<number>(g.length + 1).fill(0));
  for (let i = e.length - 1; i >= 0; i -= 1) {
    for (let j = g.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = e[i] === g[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // Matched pairs from the LCS table.
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < e.length && j < g.length; ) {
    if (e[i] === g[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1;
    else j += 1;
  }
  pairs.push([e.length, g.length]);
  // Between two matches, typed words replace expected words one-to-one ("wrong");
  // what is left over is "missing" (expected) or "extra" (typed).
  const result: DictationWord[] = [];
  const extra: string[] = [];
  let pi = 0;
  let pj = 0;
  for (const [mi, mj] of pairs) {
    const gapE = mi - pi;
    const gapG = mj - pj;
    for (let k = 0; k < gapE; k += 1) result.push({ word: exp[pi + k]!, status: k < gapG ? "wrong" : "missing" });
    for (let k = gapE; k < gapG; k += 1) extra.push(got[pj + k]!);
    if (mi < e.length) result.push({ word: exp[mi]!, status: "ok" });
    pi = mi + 1;
    pj = mj + 1;
  }
  return { isCorrect: result.every((w) => w.status === "ok") && extra.length === 0, words: result, extra };
}
