import { runSeeds } from "../src/db/seed";
import { getTestDatabaseUrl, resetTestDatabase } from "../src/test/db";

/**
 * Every E2E run starts from an empty, fully migrated and seeded test database
 * (first-run state) — the same sequence the Docker entrypoint runs.
 */
export default async function globalSetup() {
  await resetTestDatabase();
  await runSeeds(getTestDatabaseUrl(), () => {});
}
