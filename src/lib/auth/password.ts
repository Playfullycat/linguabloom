import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with Argon2id (spec §7.4), via the audited Rust
 * implementation in `@node-rs/argon2`.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet baseline for
 * Argon2id: 19 MiB memory, 2 iterations, parallelism 1. The algorithm and
 * parameters are encoded in each hash, so they can be raised later without
 * invalidating existing passwords.
 */
const ARGON2ID_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

/** Never throws: malformed or foreign hashes simply fail verification. */
export async function verifyPassword({ hash: encoded, password }: { hash: string; password: string }): Promise<boolean> {
  if (!encoded.startsWith("$argon2id$")) return false;
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}
