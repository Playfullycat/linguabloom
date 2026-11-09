import { CEFR_LEVELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";

import { words } from "./text";

/**
 * Known-word coverage (spec §5.6): the share of a text's running words the
 * learner probably knows. Research on reading (Nation; Hu & Nation 2000)
 * puts comfortable unassisted reading at about 98% coverage and reading with
 * support at about 95%.
 *
 * It is an estimate. "Probably known" means: the common-word bands up to the
 * learner's level (src/content/wordlists, Pre-A1–B2), words used outside the
 * glossary in built-in texts at or below that level, glossary and course words
 * from lower levels, the words the learner has studied, and the most common
 * function words. Names (capitalised mid-sentence) and numbers are not counted.
 * Above B2 there is no band list, so C1–C2 estimates lean low.
 */

export const EXTENSIVE_COVERAGE = 0.98;
export const INTENSIVE_COVERAGE = 0.95;

export type CoverageBand = "extensive" | "intensive" | "hard";
export const COVERAGE_BAND_LABELS: Record<CoverageBand, string> = {
  extensive: "适合泛读",
  intensive: "适合精读",
  hard: "生词偏多",
};

export function coverageBand(ratio: number): CoverageBand {
  if (ratio >= EXTENSIVE_COVERAGE) return "extensive";
  if (ratio >= INTENSIVE_COVERAGE) return "intensive";
  return "hard";
}

/** The most frequent English function words and basics: assumed known by everyone. */
const BASIC = `a an the and or but so if because than then when where what who whom whose which why how
i me my mine you your yours he him his she her hers it its we us our ours they them their theirs
this that these those here there not no yes very too also only just all some any many much more most
few little other another each every both either neither such own same
is am are was were be been being have has had do does did done can could will would shall should may might must
to of in on at by for with from up down out about into over after before under again off as
one two three four five six seven eight nine ten hundred thousand first second
i'm you're he's she's it's we're they're i've you've we've they've i'd you'd he'd she'd we'd they'd i'll you'll he'll she'll we'll they'll
cannot isn't aren't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't haven't hasn't hadn't let's that's there's what's
hello hi ok okay please thank thanks sorry mr mrs ms oh away
everyone someone anyone nobody everything something anything nothing none myself yourself himself herself itself ourselves yourselves themselves`
  .split(/\s+/)
  .filter(Boolean);

/** Common irregular forms → base form. */
const IRREGULAR: Record<string, string> = {
  went: "go", gone: "go", was: "be", were: "be", been: "be", am: "be", is: "be", are: "be",
  had: "have", has: "have", did: "do", done: "do", does: "do", said: "say", made: "make",
  took: "take", taken: "take", came: "come", saw: "see", seen: "see", got: "get", gotten: "get",
  gave: "give", given: "give", knew: "know", known: "know", thought: "think", told: "tell",
  found: "find", left: "leave", felt: "feel", kept: "keep", began: "begin", begun: "begin",
  brought: "bring", bought: "buy", ate: "eat", eaten: "eat", wrote: "write", written: "write",
  ran: "run", sat: "sit", stood: "stand", met: "meet", paid: "pay", sold: "sell", sent: "send",
  spent: "spend", won: "win", lost: "lose", held: "hold", heard: "hear", meant: "mean",
  built: "build", understood: "understand", taught: "teach", caught: "catch", fought: "fight",
  drove: "drive", driven: "drive", rode: "ride", flew: "fly", flown: "fly", grew: "grow",
  grown: "grow", threw: "throw", thrown: "throw", drew: "draw", drawn: "draw", wore: "wear",
  worn: "wear", spoke: "speak", spoken: "speak", broke: "break", broken: "break", chose: "choose",
  chosen: "choose", forgot: "forget", forgotten: "forget", slept: "sleep", swam: "swim",
  sang: "sing", rang: "ring", drank: "drink", fell: "fall", fallen: "fall", hid: "hide",
  led: "lead", lay: "lie", lain: "lie", rose: "rise", risen: "rise", shook: "shake", stole: "steal",
  struck: "strike", woke: "wake", became: "become", fed: "feed", shot: "shoot", bit: "bite", hit: "hit", lit: "light", dug: "dig", hung: "hang", stuck: "stick", swung: "swing", sought: "seek", born: "bear", wept: "weep", fled: "flee", children: "child", men: "man", women: "woman", people: "person",
  feet: "foot", teeth: "tooth", mice: "mouse", better: "good", best: "good", worse: "bad",
  worst: "bad", further: "far", farther: "far",
};

const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");

/** Accents off ("café" → "cafe") so the word splitter sees one word. */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "");

const PREFIXES = ["un", "re", "dis", "im", "in", "ir", "il", "mis", "non", "over", "under"];
/** Derivational endings: a learner who knows "fair" can read "fairness" (word families, Bauer & Nation). */
const DERIVATIONS: [string, string[]][] = [
  ["ness", [""]],
  ["ment", [""]],
  ["ful", [""]],
  ["less", [""]],
  ["ship", [""]],
  ["ably", ["able"]],
  ["ibly", ["ible"]],
  ["able", ["", "e"]],
  ["ible", ["", "e"]],
  ["ation", ["ate", "", "e"]],
  ["ion", ["", "e"]],
  ["al", ["", "e"]],
  ["or", ["", "e"]],
  ["er", ["", "e"]],
];

/** Possible dictionary forms of a word as it appears in text (most likely first). */
export function lemmaCandidates(raw: string): string[] {
  const w = norm(raw).replace(/'s$/, "");
  // Two rounds of inflection: "findings" → "finding" → "find".
  const out = new Set<string>(inflections(w).flatMap(inflections));
  // One derivational ending, then inflections of what is left ("thoughtfully" → "thoughtful" → "thought").
  for (const form of [...out]) {
    for (const [end, repl] of DERIVATIONS) {
      if (form.endsWith(end) && form.length - end.length >= 3) {
        const stem = form.slice(0, -end.length);
        // "traveller" → "travell" → "travel"
        const stems = /([b-df-hj-np-tv-z])\1$/.test(stem) ? [stem, stem.slice(0, -1)] : [stem];
        for (const s of stems) for (const r of repl) for (const f of inflections(s + r)) out.add(f);
      }
    }
  }
  // One prefix ("uncomfortable" → "comfortable" → "comfort").
  for (const form of [...out]) {
    for (const p of PREFIXES) if (form.startsWith(p) && form.length - p.length >= 4) out.add(form.slice(p.length));
  }
  return [...out];
}

function inflections(w: string): string[] {
  const out = new Set<string>([w]);
  if (IRREGULAR[w]) out.add(IRREGULAR[w]!);
  const add = (s: string) => {
    if (s.length >= 2) out.add(s);
  };
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3));
  }
  if (w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + "e");
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4));
  }
  if (w.endsWith("ly")) {
    add(w.slice(0, -2));
    if (w.endsWith("ily")) add(w.slice(0, -3) + "y");
    if (w.endsWith("lly")) add(w.slice(0, -1)); // fully → full
  }
  if (w.endsWith("er") || w.endsWith("est")) {
    const stem = w.endsWith("er") ? w.slice(0, -2) : w.slice(0, -3);
    add(stem);
    add(stem + "e");
    if (/(.)\1$/.test(stem)) add(stem.slice(0, -1));
    if (stem.endsWith("i")) add(stem.slice(0, -1) + "y");
  }
  return [...out];
}

export type LexiconSource = {
  level: string;
  /** Running text (sentences). */
  texts: string[];
  /** Words or phrases listed as above the text's level. */
  glossary: string[];
};

const levelIndex = (level: string) => Math.max(0, CEFR_LEVELS.indexOf(level as CefrLevel));
const addForms = (set: Set<string>, w: string) => {
  for (const c of lemmaCandidates(w)) set.add(c);
};

/**
 * Words assumed known at a level: non-glossary words of texts at or below it,
 * glossary words of texts below it, and the basic list.
 */
export function levelLexicon(sources: LexiconSource[], level: string, bands: Partial<Record<CefrLevel, string[]>> = {}): Set<string> {
  const max = levelIndex(level);
  const known = new Set<string>();
  for (const w of BASIC) addForms(known, w);
  // Common words of every band up to the learner's level.
  for (const [band, list] of Object.entries(bands)) {
    if (levelIndex(band) <= max) for (const w of list ?? []) addForms(known, w);
  }
  for (const s of sources) {
    const at = levelIndex(s.level);
    if (at > max) continue;
    const glossaryForms = new Set<string>();
    for (const g of s.glossary) for (const w of words(plain(g))) addForms(glossaryForms, w);
    for (const w of s.texts.flatMap((t) => words(plain(t)))) {
      if (/^\d/.test(w)) continue;
      // At the learner's own level, the text's glossary words are the new ones: not assumed known.
      if (at === max && lemmaCandidates(w).some((c) => glossaryForms.has(c))) continue;
      addForms(known, w);
    }
    if (at < max) for (const g of glossaryForms) known.add(g);
  }
  return known;
}

/** Add phrases (vocabulary the learner studied, course words) to a lexicon, word by word. */
export function withWords(lexicon: Set<string>, phrases: Iterable<string>): Set<string> {
  const out = new Set(lexicon);
  for (const p of phrases) for (const w of words(plain(p))) addForms(out, w);
  return out;
}

export type Coverage = { known: number; total: number; ratio: number; band: CoverageBand; unknown: string[] };

/** Coverage of running text against a lexicon. */
export function textCoverage(sentences: string[], lexicon: ReadonlySet<string>): Coverage {
  let known = 0;
  let total = 0;
  const unknown = new Set<string>();
  // Split segments into sentences, so the first word of each is not mistaken for a name.
  for (const sentence of sentences.flatMap((s) => s.split(/(?<=[.!?…:])\s+/))) {
    const tokens = words(plain(sentence).replace(/^["“'‘(]+/, ""));
    tokens.forEach((w, i) => {
      if (/^\d/.test(w)) return;
      // A capitalised word inside a sentence is a name: not counted.
      if (i > 0 && /^[A-Z]/.test(w) && w !== "I" && !w.startsWith("I'")) return;
      total += 1;
      if (lemmaCandidates(w).some((c) => lexicon.has(c))) known += 1;
      else unknown.add(norm(w));
    });
  }
  const ratio = total === 0 ? 1 : known / total;
  return { known, total, ratio, band: coverageBand(ratio), unknown: [...unknown] };
}
