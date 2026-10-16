/**
 * Fixed-window rate limiter.
 *
 * LIMITATION: state is in memory, per server instance. That is adequate for a
 * single-user app in development and on a single instance, but serverless
 * deployments run many instances. Replace `MemoryStore` with a shared store
 * (e.g. Upstash Redis) before any public deployment (PROJECT_PLAN.md, risk R3).
 */

export interface RateLimitRule {
  /** Maximum requests per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): { count: number; resetAt: number };
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxKeys = 10_000) {}

  increment(key: string, windowMs: number, now: number) {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.evictExpired(now);
      const bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
      return bucket;
    }
    existing.count += 1;
    return existing;
  }

  private evictExpired(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    // Still full: drop the oldest entries rather than grow without bound.
    while (this.buckets.size >= this.maxKeys) {
      const first = this.buckets.keys().next().value;
      if (first === undefined) break;
      this.buckets.delete(first);
    }
  }
}

export function createRateLimiter(rule: RateLimitRule, store: RateLimitStore = new MemoryStore()) {
  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      const { count, resetAt } = store.increment(key, rule.windowMs, now);
      return {
        allowed: count <= rule.limit,
        remaining: Math.max(rule.limit - count, 0),
        retryAfterMs: Math.max(resetAt - now, 0),
      };
    },
  };
}

/** Shared limiters (module singletons). */
export const limiters = {
  /** Password sign-in: per IP + email. */
  login: createRateLimiter({ limit: 5, windowMs: 15 * 60_000 }),
  /** Password sign-in: per email across all IPs (resists IP rotation). */
  loginPerAccount: createRateLimiter({ limit: 20, windowMs: 60 * 60_000 }),
  /** TOTP verification: per user. */
  mfa: createRateLimiter({ limit: 5, windowMs: 15 * 60_000 }),
  /** Personal CFO messages: per user, per minute (daily limits are stored in the database). */
  cfo: createRateLimiter({ limit: 8, windowMs: 60_000 }),
  /** Bank linking, sync, reconnect and disconnect: per user, per minute. */
  plaid: createRateLimiter({ limit: 10, windowMs: 60_000 }),
  /** Unauthenticated Plaid webhook endpoint: per client IP, per minute. */
  plaidWebhook: createRateLimiter({ limit: 120, windowMs: 60_000 }),
};
