// @vitest-environment node
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("Argon2id password hashing", () => {
  it("produces salted Argon2id hashes with the configured cost", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // unique salt per hash
  });

  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword({ hash, password: "correct horse battery" })).toBe(true);
    expect(await verifyPassword({ hash, password: "Correct horse battery" })).toBe(false);
  });

  it("returns false instead of throwing for malformed or foreign hashes", async () => {
    expect(await verifyPassword({ hash: "", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "$argon2id$garbage", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "salt:deadbeef", password: "x" })).toBe(false); // scrypt-style
  });
});
