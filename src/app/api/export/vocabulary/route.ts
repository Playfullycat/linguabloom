import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { reviewCards, userVocabulary, vocabularyEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";

/** Export the learner's vocabulary with review status (spec §5.4, §16.17: no lock-in). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rows = await getDb()
    .select({
      text: vocabularyEntries.text,
      pos: vocabularyEntries.partOfSpeech,
      ipa: vocabularyEntries.ipa,
      zh: vocabularyEntries.definitionZh,
      exampleEn: vocabularyEntries.exampleEn,
      exampleZh: vocabularyEntries.exampleZh,
      level: vocabularyEntries.cefrLevel,
      source: userVocabulary.addedFrom,
      status: userVocabulary.status,
      receptive: userVocabulary.receptiveMastery,
      productive: userVocabulary.productiveMastery,
      firstSeen: userVocabulary.firstSeenAt,
      nextDue: sql<string | null>`(select min(${reviewCards.dueAt})::text from ${reviewCards} where ${reviewCards.userId} = ${user.id} and ${reviewCards.entryId} = ${userVocabulary.entryId} and ${reviewCards.suspendedAt} is null)`,
    })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(and(eq(userVocabulary.userId, user.id)))
    .orderBy(userVocabulary.firstSeenAt);

  const csv = toCsv(
    ["word", "part_of_speech", "ipa", "definition_zh", "example_en", "example_zh", "cefr_level", "source", "status", "receptive_mastery", "productive_mastery", "first_seen_at", "next_due_at"],
    rows.map((r) => [r.text, r.pos, r.ipa, r.zh, r.exampleEn, r.exampleZh, r.level, r.source, r.status, r.receptive.toFixed(2), r.productive.toFixed(2), r.firstSeen, r.nextDue]),
  );
  return csvResponse(`linguabloom-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
