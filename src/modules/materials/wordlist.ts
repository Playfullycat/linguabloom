import { z } from "zod";

import list from "../../content/wordlists/core-words.json" with { type: "json" };
import { CEFR_LEVELS, type CefrLevel } from "../curriculum/domain/cefr";

/**
 * Common-word bands used to estimate known-word coverage (see
 * domain/coverage.ts). Each word counts once, in the lowest band it is listed in.
 */

const schema = z.object({
  version: z.number().int(),
  source_type: z.literal("first_party"),
  note: z.string(),
  bands: z.partialRecord(z.enum(CEFR_LEVELS), z.string()),
});

let cache: Partial<Record<CefrLevel, string[]>> | null = null;

export function loadWordBands(): Partial<Record<CefrLevel, string[]>> {
  if (cache) return cache;
  const parsed = schema.parse(list);
  const seen = new Set<string>();
  const bands: Partial<Record<CefrLevel, string[]>> = {};
  for (const level of CEFR_LEVELS) {
    const raw = parsed.bands[level];
    if (!raw) continue;
    bands[level] = raw
      .split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !seen.has(w) && seen.add(w));
  }
  cache = bands;
  return bands;
}
