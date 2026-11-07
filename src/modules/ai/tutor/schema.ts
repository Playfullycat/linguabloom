import { z } from "zod";

import { AIError } from "../provider/errors";

/**
 * Structured tutor reply (spec §5.9). Every field may be empty; the model's
 * output is validated before anything reaches the learner.
 */

const clip = (n: number) => z.string().trim().max(n * 2).transform((s) => s.slice(0, n));

export const tutorReplySchema = z.object({
  response_text: clip(4000).pipe(z.string().min(1)),
  level_adaptation: clip(20).nullish().transform((v) => v ?? null),
  correction: z
    .object({
      original: clip(500),
      corrected: clip(500),
      explanation_zh: clip(800).nullish().transform((v) => v ?? null),
      explanation_en: clip(800).nullish().transform((v) => v ?? null),
    })
    .nullish()
    .transform((v) => (v && v.original && v.corrected && v.original !== v.corrected ? v : null)),
  new_vocabulary: z
    .array(z.object({ text: clip(60).pipe(z.string().min(1)), zh: clip(120).pipe(z.string().min(1)), example: clip(240).nullish().transform((v) => v ?? null) }))
    .max(10)
    .nullish()
    .transform((v) => (v ?? []).slice(0, 6)),
  follow_up_question: clip(400).nullish().transform((v) => v || null),
  suggested_practice: z
    .array(z.union([z.string().transform((title) => ({ title: title.slice(0, 120), href: null as string | null })), z.object({ title: clip(120), href: z.string().nullish() })]))
    .max(10)
    .nullish()
    .transform((v) =>
      (v ?? []).slice(0, 4).map((p) => ({
        title: p.title,
        // Only internal links are shown; anything else becomes plain text.
        href: typeof p.href === "string" && /^\/[a-z0-9/_-]*$/i.test(p.href) ? p.href : null,
      })),
    ),
});

export type TutorReply = z.infer<typeof tutorReplySchema>;

/** Parse a model's JSON reply, tolerating code fences or text around the object. */
export function parseTutorReply(text: string): TutorReply {
  const candidates = [text, text.replace(/^```(?:json)?\s*|\s*```$/g, ""), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c.trim().startsWith("{")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(c);
    } catch {
      continue;
    }
    const parsed = tutorReplySchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  throw new AIError("invalid_response", "tutor reply failed validation");
}
