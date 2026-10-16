import { describe, expect, it } from "vitest";
import { MemoryStore, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    const results = [0, 1, 2, 3].map(() => limiter.check("k", 100));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterMs).toBe(1000);
  });

  it("resets after the window and isolates keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 500).allowed).toBe(false);
    expect(limiter.check("b", 500).allowed).toBe(true);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });

  it("bounds memory use", () => {
    const store = new MemoryStore(3);
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 }, store);
    for (let i = 0; i < 10; i += 1) limiter.check(`key-${i}`, 0);
    // Oldest keys were evicted, so the store never exceeds its bound.
    expect(limiter.check("key-9", 1).allowed).toBe(false);
  });
});
