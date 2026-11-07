import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Low-level connection factory. Safe to import from scripts and tests
 * (no `server-only`). App code should use `getDb()` from `@/db`.
 */
export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: "linguabloom", TimeZone: "UTC" },
  });
  const db = drizzle({ client, schema });
  return { db, client };
}

export type Database = ReturnType<typeof createDb>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the pooled database or an open transaction. */
export type DbExecutor = Database | Transaction;
