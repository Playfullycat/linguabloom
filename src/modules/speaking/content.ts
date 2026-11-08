import { z } from "zod";

import tasks from "../../content/speaking/tasks.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

/** Built-in speaking tasks (spec §5.10). Reviewed content, versioned in the repo. */

export const SPEAKING_TYPES = ["read_aloud", "repeat_sentence", "short_answer", "guided_conversation", "roleplay", "retelling", "opinion"] as const;
export type SpeakingType = (typeof SPEAKING_TYPES)[number];

/** Scripted tasks: the learner says given sentences one by one (recorded and transcribed, no conversation). */
export const SCRIPTED_TYPES: readonly SpeakingType[] = ["read_aloud", "repeat_sentence"];
export const isScripted = (type: SpeakingType) => SCRIPTED_TYPES.includes(type);

export const SPEAKING_TYPE_LABELS: Record<SpeakingType, string> = {
  read_aloud: "朗读",
  repeat_sentence: "跟读复述",
  short_answer: "简单回答",
  guided_conversation: "引导对话",
  roleplay: "情景对话",
  retelling: "故事复述",
  opinion: "观点表达",
};

export const SPEAKING_MODE_LABELS = { realtime: "实时语音", standard: "标准语音模式", typed: "文字回答" } as const;

const text = z.string().trim().min(1);

export const speakingTaskSchema = z
  .object({
    id: z.string().regex(/^sp-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    type: z.enum(SPEAKING_TYPES),
    level: z.enum(CEFR_LEVELS),
    title_zh: text,
    title_en: text,
    goal_zh: text,
    instructions_zh: text,
    can_do_zh: text,
    /** Scripted tasks: the sentences to say. */
    items: z.array(text.max(200)).min(1).max(8).optional(),
    /** Conversation tasks: the teacher's first line (spoken without an AI call in standard mode). */
    opening_en: text.max(300).optional(),
    /** Questions the teacher works through, in order. */
    questions: z.array(text.max(200)).max(8).optional(),
    /** Extra role / scene instructions for the AI. */
    setup_en: text.max(800).optional(),
    /** Retelling: the built-in material to retell. */
    source_material: z.string().optional(),
    key_phrases: z.array(text.max(80)).max(8).default([]),
    /** Learner turns before the teacher closes (standard mode). */
    max_turns: z.number().int().min(2).max(12).default(6),
  })
  .superRefine((t, ctx) => {
    const scripted = isScripted(t.type);
    if (scripted && !t.items) ctx.addIssue({ code: "custom", message: `${t.id}: scripted tasks need items` });
    if (!scripted && !t.opening_en) ctx.addIssue({ code: "custom", message: `${t.id}: conversation tasks need opening_en` });
    if (t.type === "retelling" && !t.source_material) ctx.addIssue({ code: "custom", message: `${t.id}: retelling needs source_material` });
  });

export type SpeakingTask = z.infer<typeof speakingTaskSchema>;

const fileSchema = z.object({
  schema_version: z.literal(1),
  source_type: z.literal("first_party"),
  review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
  tasks: z.array(speakingTaskSchema).min(1),
});

let cache: SpeakingTask[] | undefined;

export function loadSpeakingTasks(): SpeakingTask[] {
  if (cache) return cache;
  const parsed = fileSchema.parse(tasks);
  const ids = parsed.tasks.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate speaking task id");
  cache = parsed.tasks;
  return cache;
}

export function getSpeakingTask(id: string): SpeakingTask | undefined {
  return loadSpeakingTasks().find((t) => t.id === id);
}
