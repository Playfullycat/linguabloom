import type { DbExecutor } from "../connection";

/**
 * A seed loads versioned, reviewed content into the database.
 * Seeds must be idempotent (safe to run on every deploy) and must validate
 * their source file before writing anything.
 */
export type Seed = {
  name: string;
  run(db: DbExecutor): Promise<{ rows: number }>;
};
