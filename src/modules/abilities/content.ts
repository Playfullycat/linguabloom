import { z } from "zod";

import catalog from "../../content/can-do/catalog.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";
import { loadContent } from "../curriculum/content/load";
import { SKILLS, type Skill } from "../curriculum/content/schema";
import { loadGrammar } from "../grammar/content";
import { loadMaterials } from "../materials/content";
import { loadSpeakingTasks } from "../speaking/content";
import { loadWritingPrompts } from "../writing/content";

/**
 * All can-do statements (spec §2.1): the unit objectives from the course files
 * plus the level-wide catalog, and the practice that can give evidence for
 * each of them. Everything is cross-checked: an unknown can-do id anywhere in
 * the content is an error.
 */

export const SKILL_LABELS: Record<Skill, string> = {
  listening: "听力理解",
  reading: "阅读理解",
  spoken_production: "口头表达",
  spoken_interaction: "口语互动",
  written_production: "书面表达",
  written_interaction: "书面互动",
  mediation: "转述与解释",
  phonology: "发音可理解度",
  vocabulary: "词汇",
  grammar: "语法",
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  lesson: "课程练习",
  exercise: "语法练习",
  material: "阅读 / 听力理解题",
  speaking: "口语练习",
  writing: "写作",
};

export type EvidenceType = "lesson" | "exercise" | "material" | "speaking" | "writing";

export type PassRule = { minWeight: number; minDays: number; minRate: number; needsMedium: boolean };

const PRODUCTIVE: readonly Skill[] = ["spoken_production", "spoken_interaction", "written_production", "written_interaction", "mediation", "phonology"];

/**
 * When a statement counts as shown (see domain/status.ts): receptive skills need
 * more but simpler evidence; productive skills fewer, but at least one piece
 * must be more than a self-rating.
 */
export function defaultPassRule(skill: Skill): PassRule {
  return PRODUCTIVE.includes(skill) ? { minWeight: 2, minDays: 2, minRate: 0.6, needsMedium: true } : { minWeight: 3, minDays: 2, minRate: 0.7, needsMedium: false };
}

const slug = z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/);
const text = z.string().trim().min(1);

const catalogSchema = z.object({
  schema_version: z.literal(1),
  source_type: z.literal("first_party"),
  review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
  note: z.string().optional(),
  statements: z
    .array(z.object({ id: slug, level: z.enum(CEFR_LEVELS), skill: z.enum(SKILLS), en: text, zh: text, prerequisites: z.array(slug).default([]) }))
    .min(1),
});

/** A place to practise (and so give evidence) for a statement. */
export type PracticeRoute = { type: EvidenceType; id: string; title: string; href: string };

export type CanDoStatement = {
  id: string;
  level: (typeof CEFR_LEVELS)[number];
  skill: Skill;
  en: string;
  zh: string;
  origin: string;
  prerequisites: string[];
  passRule: PassRule;
  routes: PracticeRoute[];
  evidenceTypes: EvidenceType[];
  sortOrder: number;
};

export type CanDoLinks = {
  /** lesson id → can-do ids */
  lessons: Map<string, string[]>;
  /** grammar point id → can-do ids */
  grammarPoints: Map<string, string[]>;
  /** material id → can-do ids */
  materials: Map<string, string[]>;
  speakingTasks: Map<string, string[]>;
  writingPrompts: Map<string, string[]>;
};

let cache: { statements: CanDoStatement[]; links: CanDoLinks } | undefined;

export function loadCanDo(): { statements: CanDoStatement[]; links: CanDoLinks } {
  if (cache) return cache;
  const problems: string[] = [];
  const parsed = catalogSchema.parse(catalog);
  const { units } = loadContent();

  const byId = new Map<string, Omit<CanDoStatement, "routes" | "evidenceTypes" | "sortOrder">>();
  for (const [unitId, file] of units) {
    for (const c of file.unit.can_do) {
      if (byId.has(c.id)) problems.push(`duplicate can-do id ${c.id} (unit ${unitId})`);
      byId.set(c.id, { id: c.id, level: file.unit.level, skill: c.skill, en: c.en, zh: c.zh, origin: `unit:${unitId}`, prerequisites: [], passRule: defaultPassRule(c.skill) });
    }
  }
  for (const c of parsed.statements) {
    if (byId.has(c.id)) problems.push(`duplicate can-do id ${c.id} (catalog)`);
    byId.set(c.id, { id: c.id, level: c.level, skill: c.skill, en: c.en, zh: c.zh, origin: "catalog", prerequisites: c.prerequisites, passRule: defaultPassRule(c.skill) });
  }
  for (const s of byId.values()) for (const p of s.prerequisites) if (!byId.has(p)) problems.push(`${s.id}: unknown prerequisite ${p}`);

  const routes = new Map<string, PracticeRoute[]>([...byId.keys()].map((id) => [id, []]));
  const links: CanDoLinks = { lessons: new Map(), grammarPoints: new Map(), materials: new Map(), speakingTasks: new Map(), writingPrompts: new Map() };
  const link = (map: Map<string, string[]>, where: string, ids: string[], route: Omit<PracticeRoute, "id"> & { id: string }) => {
    const known = ids.filter((id) => {
      if (byId.has(id)) return true;
      problems.push(`${where}: unknown can-do id ${id}`);
      return false;
    });
    if (known.length === 0) return;
    map.set(route.id, known);
    for (const id of known) routes.get(id)!.push(route);
  };

  for (const file of units.values()) {
    for (const lesson of file.unit.lessons) link(links.lessons, `lesson ${lesson.id}`, lesson.can_do_ids, { type: "lesson", id: lesson.id, title: lesson.title_zh, href: `/lesson/${lesson.id}` });
  }
  for (const p of loadGrammar().filter((x) => x.status === "published")) link(links.grammarPoints, `grammar ${p.id}`, p.can_do_ids, { type: "exercise", id: p.id, title: p.title_zh, href: `/grammar/${p.id}` });
  for (const m of loadMaterials()) link(links.materials, `material ${m.id}`, m.can_do_ids, { type: "material", id: m.id, title: m.title_zh, href: `/${m.type === "listening" ? "listening" : "reading"}/${m.id}` });
  for (const t of loadSpeakingTasks()) link(links.speakingTasks, `speaking ${t.id}`, t.can_do_ids, { type: "speaking", id: t.id, title: t.title_zh, href: `/speaking/${t.id}` });
  for (const w of loadWritingPrompts()) link(links.writingPrompts, `writing ${w.id}`, w.can_do_ids, { type: "writing", id: w.id, title: w.title_zh, href: `/writing/new?prompt=${w.id}` });

  if (problems.length > 0) throw new Error(`Invalid can-do content:\n  ${problems.join("\n  ")}`);

  const levelIndex = (l: string) => CEFR_LEVELS.indexOf(l as (typeof CEFR_LEVELS)[number]);
  const statements = [...byId.values()]
    .sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || SKILLS.indexOf(a.skill) - SKILLS.indexOf(b.skill) || a.id.localeCompare(b.id))
    .map((s, i) => {
      const r = routes.get(s.id)!;
      return { ...s, routes: r, evidenceTypes: [...new Set(r.map((x) => x.type))], sortOrder: i };
    });
  cache = { statements, links };
  return cache;
}
