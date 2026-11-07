/**
 * Load versioned seed content (idempotent).  Usage:  npm run db:seed
 * Run after `npm run db:migrate`.
 */
import { existsSync } from "node:fs";

import { runSeeds } from "../src/db/seed";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

try {
  await runSeeds(url);
} catch (error) {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
