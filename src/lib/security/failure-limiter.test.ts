// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createFailureLimiter } from "./failure-limiter";

function setup(maxFailures = 3, windowMs = 1000) {
  let t = 0;
  const limiter = createFailureLimiter({ maxFailures, windowMs, now: () => t });
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe("createFailureLimiter", () => {
  it("blocks a key after maxFailures and reports the wait", () => {
    const { limiter, advance } = setup();
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    expect(limiter.check("a").blocked).toBe(false);
    limiter.recordFailure("a");
    advance(400);
    expect(limiter.check("a")).toEqual({ blocked: true, retryAfterMs: 600 });
  });

  it("unblocks when the window ends", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("a");
    advance(1000);
    expect(limiter.check("a").blocked).toBe(false);
    limiter.recordFailure("a"); // starts a fresh window
    expect(limiter.check("a").blocked).toBe(false);
  });

  it("keeps keys independent and supports reset", () => {
    const { limiter } = setup(1);
    limiter.recordFailure("a");
    expect(limiter.check("a").blocked).toBe(true);
    expect(limiter.check("b").blocked).toBe(false);
    limiter.reset("a");
    expect(limiter.check("a").blocked).toBe(false);
  });
});
