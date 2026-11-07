import { z } from "zod";

/**
 * Server environment, validated with Zod.
 *
 * Parsed lazily on first use (not at import time) so `next build` and Docker
 * image builds work without runtime secrets. Never import this from a Client
 * Component: it reads secrets.
 */

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET must be at least 32 characters (use a long random value)")
    .refine((v) => !v.startsWith("replace-with"), "APP_SECRET still has the example value"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  OWNER_SETUP_ENABLED: booleanFlag.default(true),
  /** Optional extra protection for first-run setup on an internet-facing host. */
  OWNER_SETUP_TOKEN: optionalString,

  STORAGE_ROOT: z.string().default("./data"),
  DEFAULT_LOCALE: z.string().default("zh-CN"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Shanghai"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // AI (Phase 3). Non-AI features must work with AI disabled.
  AI_ENABLED: booleanFlag.default(false),
  AI_PROVIDER: z.enum(["openai"]).default("openai"),
  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalString,
  AI_TEXT_MODEL: optionalString,
  AI_REALTIME_MODEL: optionalString,
  AI_TRANSCRIPTION_MODEL: optionalString,
  AI_TTS_MODEL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

/** Validate an env-like record. Throws a readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** True when cookies must be Secure (HTTPS deployment). */
export function isHttpsApp(env: Env = getEnv()): boolean {
  return env.APP_URL.startsWith("https://");
}
