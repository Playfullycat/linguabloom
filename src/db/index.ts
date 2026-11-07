import "server-only";

import { getEnv } from "@/lib/config/env";

import { createDb, type Database } from "./connection";

export type { Database } from "./connection";

// Reuse one pool per process; survive dev hot reloads.
const globalForDb = globalThis as unknown as { __linguabloomDb?: Database };

/** Shared database for server code. The browser never connects to PostgreSQL. */
export function getDb(): Database {
  globalForDb.__linguabloomDb ??= createDb(getEnv().DATABASE_URL).db;
  return globalForDb.__linguabloomDb;
}
