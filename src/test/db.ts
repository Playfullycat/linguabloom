/**
 * Test database helpers for integration and E2E tests.
 *
 * The test database is separate from the development database and is wiped
 * on every run. As a guard, nothing is dropped unless the database name ends
 * with "_test".
 *
 * Uses relative imports only, so Playwright can load it without path aliases.
 */
import { existsSync } from "node:fs";

import postgres from "postgres";

import { runMigrations } from "../db/migrate";

export function loadDotEnv() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function getTestDatabaseUrl(): string {
  loadDotEnv();
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run database tests (see .env.example).");
  const url = new URL(base);
  url.pathname = `${url.pathname}_test`; // "/linguabloom" → "/linguabloom_test"
  return url.toString();
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function assertTestDatabase(url: string) {
  const name = databaseName(url);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to reset database "${name}": test database names must end with "_test".`);
  }
}

/** Create the test database if it does not exist yet. */
export async function ensureTestDatabase(url = getTestDatabaseUrl()) {
  assertTestDatabase(url);
  const name = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select 1 from pg_database where datname = ${name}`;
    if (rows.length === 0) await sql.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } finally {
    await sql.end();
  }
}

/** Drop everything in the test database and apply all migrations from scratch. */
export async function resetTestDatabase(url = getTestDatabaseUrl()) {
  assertTestDatabase(url);
  await ensureTestDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;");
  } finally {
    await sql.end();
  }
  await runMigrations(url);
}

/** Empty all application tables (fast reset between tests). */
export async function truncateAll(url = getTestDatabaseUrl()) {
  assertTestDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      "truncate table pte_attempts, pte_prompts, pte_rubrics, pte_task_types, exam_versions, can_do_evidence, can_do_statements, speaking_attempts, ai_definitions, ai_generations, writing_submissions, ai_messages, ai_sessions, ai_usage, content_imports, media_assets, error_occurrences, error_items, exercise_attempts, exercises, grammar_points, user_content_state, content_interactions, transcript_segments, learning_contents, study_plan_tasks, study_plans, skill_estimates, assessment_attempts, assessment_sessions, assessment_items, study_preferences, learner_profiles, review_logs, review_cards, user_vocabulary, vocabulary_entries, lesson_step_attempts, learner_lesson_progress, lesson_steps, lessons, units, courses, app_instance, verifications, sessions, accounts, users, cefr_levels restart identity cascade",
    );
  } finally {
    await sql.end();
  }
}
