// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isHttpsApp, parseEnv } from "./env";

const valid = {
  APP_SECRET: "x".repeat(40),
  DATABASE_URL: "postgresql://lingua:pw@localhost:5432/linguabloom",
};

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies safe defaults", () => {
    const env = parseEnv(valid);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.OWNER_SETUP_ENABLED).toBe(true);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.OWNER_SETUP_TOKEN).toBeUndefined();
  });

  it("rejects missing, short or example secrets", () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/APP_SECRET/);
    expect(() => parseEnv({ ...valid, APP_SECRET: "too-short" })).toThrow(/at least 32/);
    expect(() => parseEnv({ ...valid, APP_SECRET: "replace-with-long-random-secret-xxxxxxxx" })).toThrow(/example value/);
  });

  it("requires a PostgreSQL connection string", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("parses boolean flags and treats empty optional values as unset", () => {
    const env = parseEnv({ ...valid, OWNER_SETUP_ENABLED: "false", AI_ENABLED: "1", OWNER_SETUP_TOKEN: "  " });
    expect(env.OWNER_SETUP_ENABLED).toBe(false);
    expect(env.AI_ENABLED).toBe(true);
    expect(env.OWNER_SETUP_TOKEN).toBeUndefined();
  });

  it("lists every problem at once without echoing secret values", () => {
    try {
      parseEnv({ APP_SECRET: "short-secret-value", DATABASE_URL: "nope" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/APP_SECRET/);
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).not.toContain("short-secret-value");
    }
  });

  it("detects HTTPS deployments for Secure cookies", () => {
    expect(isHttpsApp(parseEnv(valid))).toBe(false);
    expect(isHttpsApp(parseEnv({ ...valid, APP_URL: "https://lingua.example.com" }))).toBe(true);
  });
});
