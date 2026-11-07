import type { BadgeTone } from "@/components/ui/badge";
import type { Mastery } from "@/modules/grammar/services/grammar";

/** Badge colour per mastery state (shared by the grammar map and point pages). */
export const MASTERY_TONES: Record<Mastery, BadgeTone> = {
  planned: "outline",
  not_started: "neutral",
  practising: "blue",
  mastered: "mint",
  weak: "coral",
};
