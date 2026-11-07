/**
 * In-memory limiter for repeated failures (e.g. wrong passwords).
 *
 * Fixed window per key. Suitable for this single-instance, self-hosted app;
 * a multi-instance deployment would need shared storage (PostgreSQL/Redis).
 */
type Bucket = { count: number; resetAt: number };

export type FailureLimiter = {
  /** Whether `key` is currently blocked, and for how long. */
  check(key: string): { blocked: boolean; retryAfterMs: number };
  recordFailure(key: string): void;
  reset(key: string): void;
};

const MAX_KEYS = 10_000;

export function createFailureLimiter({
  maxFailures,
  windowMs,
  now = Date.now,
}: {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}): FailureLimiter {
  const buckets = new Map<string, Bucket>();

  function live(key: string): Bucket | undefined {
    const bucket = buckets.get(key);
    if (bucket && bucket.resetAt <= now()) {
      buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  function prune() {
    const t = now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(key);
    // Still too many (flood of distinct keys): drop the oldest entries.
    while (buckets.size > MAX_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    check(key) {
      const bucket = live(key);
      if (!bucket || bucket.count < maxFailures) return { blocked: false, retryAfterMs: 0 };
      return { blocked: true, retryAfterMs: Math.max(0, bucket.resetAt - now()) };
    },
    recordFailure(key) {
      const bucket = live(key);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { count: 1, resetAt: now() + windowMs });
        if (buckets.size > MAX_KEYS) prune();
      }
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
