import { createDb } from "../connection";
import { cefrLevelsSeed } from "./cefr-levels";
import { assessmentSeed } from "./assessment";
import { booksSeed } from "./books";
import { canDoSeed } from "./can-do";
import { curriculumSeed } from "./curriculum";
import { grammarSeed } from "./grammar";
import { materialsSeed } from "./materials";
import { pteSeed } from "./pte";
import type { Seed } from "./types";

/** Seeds run in this order. Add new content seeds here. */
export const SEEDS: Seed[] = [cefrLevelsSeed, curriculumSeed, assessmentSeed, materialsSeed, grammarSeed, canDoSeed, pteSeed, booksSeed];

export async function runSeeds(databaseUrl: string, log: (line: string) => void = console.log) {
  const { db, client } = createDb(databaseUrl, { max: 1 });
  try {
    for (const seed of SEEDS) {
      const result = await db.transaction((tx) => seed.run(tx));
      log(`seed ${seed.name}: ${result.rows} rows`);
    }
  } finally {
    await client.end();
  }
}
