import { z } from "zod";

import { HISTORY_LIMIT, MESSAGE_CHARS } from "../services/tutor";

import { ROLEPLAY_SCENES, TUTOR_MODES } from "./prompts";

/** Validated tutor request (server action and streaming route share it). */
export const tutorRequestSchema = z.object({
  mode: z.enum(TUTOR_MODES),
  message: z.string().trim().min(1, "请输入内容").max(MESSAGE_CHARS, `最多 ${MESSAGE_CHARS} 个字符`),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(MESSAGE_CHARS * 4) }))
    .max(HISTORY_LIMIT * 2)
    .default([]),
  sessionId: z.uuid().nullable().default(null),
  scene: z.enum(ROLEPLAY_SCENES.map((s) => s.id) as [string, ...string[]]).optional(),
  /** An inline "check this sentence": answered, counted in usage, never saved as a conversation. */
  check: z.boolean().optional(),
  material: z.object({ contentId: z.string().min(1).max(120), seq: z.number().int().min(0).max(1000).nullable() }).optional(),
});
export type TutorRequestInput = z.input<typeof tutorRequestSchema>;
