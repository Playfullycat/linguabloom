import type { CefrLevel } from "../domain/cefr";

/**
 * Publish gate (spec §14.3, §15.2 and the Phase 5 acceptance): a unit may only
 * be marked "published" when it can really be learned. Drafts may be partial.
 * Each rule returns readable problems; the unit schema turns them into
 * validation errors, so the seed refuses a unit that does not pass.
 */

/** Longest dialogue line (in words) a learner at each level is expected to follow. */
export const MAX_LINE_WORDS: Record<CefrLevel, number> = { pre_a1: 12, a1: 15, a2: 20, b1: 25, b2: 30, c1: 35, c2: 40 };

/** Objectively scored steps each lesson needs so it is practice, not only reading. */
export const MIN_SCORED_STEPS = 3;

type Step = { id: string; type: string; role: string; skill: string; [k: string]: unknown };
type Lesson = { id: string; kind: "core" | "review"; can_do_ids: string[]; steps: Step[] };
type GateUnit = {
  level: CefrLevel;
  can_do: { id: string }[];
  vocabulary: { key: string }[];
  lessons: Lesson[];
};
type GateFile = { source_type: string; source?: { title: string; license: string } | undefined; unit: GateUnit };

const SCORED = new Set(["choice", "cloze", "order", "match"]);
const OUTPUT = new Set(["speak", "write"]);

/** Words of a sentence, ignoring punctuation and case, sorted (order-step check). */
export function sortedWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function publishProblems(file: GateFile): string[] {
  const { unit } = file;
  const problems: string[] = [];
  const lessons = unit.lessons;
  const steps = lessons.flatMap((l) => l.steps);

  // Structure (spec §15.2).
  if (lessons.filter((l) => l.kind === "core").length < 3) problems.push("published units need at least 3 core lessons");
  const reviews = lessons.filter((l) => l.kind === "review");
  if (reviews.length === 0) problems.push("published units need a unit review lesson");

  // Meaning-focused input, listening and output (spec §14.3).
  if (!steps.some((s) => s.type === "dialogue")) problems.push("published units need meaning-focused input (a dialogue)");
  if (!steps.some((s) => s.skill === "listening")) problems.push("published units need a listening activity");
  if (!steps.some((s) => OUTPUT.has(s.type))) problems.push("published units need an output task");
  for (const l of lessons.filter((x) => x.kind === "core")) {
    if (!l.steps.some((s) => s.role === "input")) problems.push(`${l.id}: core lessons need an input step`);
  }
  for (const l of reviews) {
    if (!l.steps.some((s) => s.role === "communicative_task" && OUTPUT.has(s.type))) problems.push(`${l.id}: the review lesson needs a speaking or writing task`);
  }

  // Real practice with answers.
  for (const l of lessons) {
    const scored = l.steps.filter((s) => SCORED.has(s.type)).length;
    if (scored < MIN_SCORED_STEPS) problems.push(`${l.id}: needs at least ${MIN_SCORED_STEPS} scored steps (has ${scored})`);
    for (const s of l.steps) {
      const where = `${l.id}.${s.id}`;
      if (s.type === "choice") {
        const options = (s.options as string[]).map((o) => o.trim().toLowerCase());
        if (new Set(options).size !== options.length) problems.push(`${where}: duplicate choice options`);
      }
      if (s.type === "order") {
        const tokens = sortedWords((s.tokens as string[]).join(" "));
        for (const answer of s.answers as string[]) if (sortedWords(answer) !== tokens) problems.push(`${where}: order answer "${answer}" does not use exactly the tokens`);
      }
      if (s.type === "cloze") {
        const answers = (s.answers as string[]).map((a) => a.trim().toLowerCase());
        if (new Set(answers).size !== answers.length) problems.push(`${where}: duplicate cloze answers`);
      }
      if (s.type === "dialogue") {
        const limit = MAX_LINE_WORDS[unit.level];
        for (const line of s.lines as { en: string }[]) {
          const words = line.en.split(/\s+/).filter(Boolean).length;
          if (words > limit) problems.push(`${where}: dialogue line has ${words} words (max ${limit} at this level): "${line.en}"`);
        }
      }
    }
  }

  // Everything the unit promises is actually taught.
  const targeted = new Set(lessons.flatMap((l) => l.can_do_ids));
  for (const c of unit.can_do) if (!targeted.has(c.id)) problems.push(`can-do ${c.id} is not practised by any lesson`);
  const taught = new Set(steps.filter((s) => s.type === "vocab").flatMap((s) => s.items as string[]));
  for (const v of unit.vocabulary) if (!taught.has(v.key)) problems.push(`vocabulary ${v.key} is not introduced in any vocab step`);

  // Source (spec §14.3): third-party content must name where it comes from.
  if (file.source_type !== "first_party" && !file.source) problems.push(`${file.source_type} content needs a source (title and license)`);

  return problems;
}
