/**
 * Apply database migrations.  Usage:  npm run db:migrate
 * Reads DATABASE_URL from the environment (or .env when present).
 * MIGRATIONS_DIR overrides the SQL folder (the Docker image sets /app/migrations).
 */
import { existsSync } from "node:fs";

import { runMigrations } from "../src/db/migrate";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

try {
  await runMigrations(url, process.env.MIGRATIONS_DIR || undefined);
  console.log("migrations: up to date");
} catch (error) {
  console.error("migrations failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
