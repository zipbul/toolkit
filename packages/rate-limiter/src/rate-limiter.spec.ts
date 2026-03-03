import { describe, test, expect, beforeEach } from 'bun:test';

import { RateLimiter } from './rate-limiter';
import { RateLimiterError } from './interfaces';
import type { RateLimitAllowResult, RateLimitDenyResult, RateLimiterStore, StoreEntry } from './interfaces';
import { RateLimitAction, RateLimiterErrorReason, Algorithm } from './enums';
import { MemoryStore } from './stores/memory';
import { WithFallbackStore, withFallback } from './stores/with-fallback';
import { validateRateLimiterOptions, resolveRateLimiterOptions } from './options';

// ── Helpers ─────────────────────────────────────────────────────────

function createClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
  };
}

function createAsyncStore(): RateLimiterStore & { inner: MemoryStore } {
  const inner = new MemoryStore();
  return {
    inner,
    update: async (key: string, updater: (current: StoreEntry | null) => StoreEntry) => inner.update(key, updater),
    get: async (key: string) => inner.get(key),
    clear: async () => inner.clear(),
  };
}

// ── Validation ──────────────────────────────────────────────────────

describe('RateLimiter.create — validation', () => {
  test('throws EmptyRules on empty rules array', () => {
    try {
      RateLimiter.create({ rules: [] });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimiterError);
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.EmptyRules);
    }
  });

  test('throws InvalidLimit on non-positive limit', () => {
    for (const limit of [0, -1, 1.5, NaN]) {
      try {
        RateLimiter.create({ rules: { limit, window: 1000 } });
        expect(true).toBe(false);
      } catch (e) {
        expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.InvalidLimit);
      }
    }
  });

  test('throws InvalidWindow on non-positive window', () => {
    for (const window of [0, -1, 1.5, NaN]) {
      try {
        RateLimiter.create({ rules: { limit: 10, window } });
        expect(true).toBe(false);
      } catch (e) {
        expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.InvalidWindow);
      }
    }
  });

  test('throws InvalidCost on negative default cost', () => {
    try {
      RateLimiter.create({ rules: { limit: 10, window: 1000 }, cost: -1 });
      expect(true).toBe(false);
    } catch (e) {
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.InvalidCost);
    }
  });

  test('rejects invalid algorithm via direct validation', () => {
    const resolved = resolveRateLimiterOptions({ rules: { limit: 10, window: 1000 } });
    (resolved as any).algorithm = 999;
    const result = validateRateLimiterOptions(resolved);
    expect(result).toBeDefined();
    expect((result as any).data.reason).toBe(RateLimiterErrorReason.InvalidAlgorithm);
  });

  test('accepts valid options', () => {
    expect(() => RateLimiter.create({ rules: { limit: 10, window: 1000 } })).not.toThrow();
    expect(() => RateLimiter.create({ rules: [{ limit: 10, window: 1000 }] })).not.toThrow();
    expect(() => RateLimiter.create({ rules: { limit: 10, window: 1000 }, cost: 0 })).not.toThrow();
  });

  test('accepts all algorithm values', () => {
    for (const algorithm of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
      expect(() => RateLimiter.create({ rules: { limit: 10, window: 1000 }, algorithm })).not.toThrow();
    }
  });
});

// ── Per-call cost validation ────────────────────────────────────────

describe('per-call cost validation', () => {
  test('throws InvalidCost on negative per-call cost', async () => {
    const limiter = RateLimiter.create({ rules: { limit: 10, window: 1000 } });
    try {
      await limiter.consume('user1', { cost: -1 });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimiterError);
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.InvalidCost);
    }
  });

  test('throws InvalidCost on fractional per-call cost', async () => {
    const limiter = RateLimiter.create({ rules: { limit: 10, window: 1000 } });
    try {
      await limiter.consume('user1', { cost: 0.5 });
      expect(true).toBe(false);
    } catch (e) {
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.InvalidCost);
    }
  });

  test('per-call cost overrides default cost', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      cost: 3,
    });

    // Override with cost: 1
    const r1 = await limiter.consume('user1', { cost: 1 });
    expect(r1.remaining).toBe(9);

    // Use default cost: 3
    const r2 = await limiter.consume('user1');
    expect(r2.remaining).toBe(6);
  });
});

// ── Sliding Window ──────────────────────────────────────────────────

describe('SlidingWindow algorithm', () => {
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => { clock = createClock(1000); });

  test('allows requests within limit', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 3, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1');
    expect(r1.action).toBe(RateLimitAction.Allow);
    expect(r1.remaining).toBe(2);
    expect(r1.limit).toBe(3);

    const r2 = await limiter.consume('user1');
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.consume('user1');
    expect(r3.remaining).toBe(0);
  });

  test('denies requests exceeding limit with correct retryAfter', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');

    const r3 = await limiter.consume('user1');
    expect(r3.action).toBe(RateLimitAction.Deny);
    expect(r3.remaining).toBe(0);
    // Window started at 1000, ends at 2000, now=1000 → retryAfter=1000
    expect((r3 as RateLimitDenyResult).retryAfter).toBe(1000);
    expect(r3.resetAt).toBe(2000);
  });

  test('resets after window expires', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');
    clock.advance(1001);

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
  });

  test('sliding window interpolates previous window precisely', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    for (let i = 0; i < 10; i++) {
      await limiter.consume('user1');
    }

    // Move to 50% into next window
    clock.advance(1500);
    // weight = 1 - (500/1000) = 0.5 → estimated = 0 + floor(10*0.5) = 5
    // consuming 1 → remaining = 10 - (5+1) = 4
    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
    expect(r.remaining).toBe(4);
  });

  test('isolates different keys', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user2')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });

  test('supports custom cost', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1', { cost: 5 });
    expect(r1.remaining).toBe(5);

    const r2 = await limiter.consume('user1', { cost: 6 });
    expect(r2.action).toBe(RateLimitAction.Deny);
  });

  test('cost=0 does not consume', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1', { cost: 0 });
    expect(r1.action).toBe(RateLimitAction.Allow);
    expect(r1.remaining).toBe(1);

    const r2 = await limiter.consume('user1');
    expect(r2.action).toBe(RateLimitAction.Allow);
    expect(r2.remaining).toBe(0);
  });

  test('cost > limit is denied on first request', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r = await limiter.consume('user1', { cost: 10 });
    expect(r.action).toBe(RateLimitAction.Deny);
    expect(r.remaining).toBe(0);
  });

  test('both windows expired resets completely', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');
    clock.advance(2001);

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
    expect(r.remaining).toBe(1);
  });

  test('works with async store', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      store: createAsyncStore(),
    });

    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });
});

// ── GCRA ────────────────────────────────────────────────────────────

describe('GCRA algorithm', () => {
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => { clock = createClock(1000); });

  test('allows requests within limit', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 3, window: 3000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1');
    expect(r1.action).toBe(RateLimitAction.Allow);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.consume('user1');
    expect(r2.action).toBe(RateLimitAction.Allow);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.consume('user1');
    expect(r3.action).toBe(RateLimitAction.Allow);
    expect(r3.remaining).toBe(0);
  });

  test('denies when burst exceeded with correct retryAfter', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    // emission_interval = 1000ms, burstOffset = 2000ms
    await limiter.consume('user1'); // TAT = 2000
    await limiter.consume('user1'); // TAT = 3000

    const r3 = await limiter.consume('user1');
    expect(r3.action).toBe(RateLimitAction.Deny);
    expect(r3.remaining).toBe(0);
    // newTat would be 4000, allowAt = 4000-2000 = 2000, retryAfter = 2000-1000 = 1000
    expect((r3 as RateLimitDenyResult).retryAfter).toBe(1000);
  });

  test('allows after sufficient time', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');
    clock.advance(1000);

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
  });

  test('cost=0 does not consume', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1', { cost: 0 });
    expect(r1.action).toBe(RateLimitAction.Allow);

    const r2 = await limiter.consume('user1');
    expect(r2.action).toBe(RateLimitAction.Allow);
  });

  test('cost > limit is denied on first request', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    const r = await limiter.consume('user1', { cost: 5 });
    expect(r.action).toBe(RateLimitAction.Deny);
    expect(r.remaining).toBe(0);
    expect((r as RateLimitDenyResult).retryAfter).toBeGreaterThan(0);
    expect(Number.isFinite((r as RateLimitDenyResult).retryAfter)).toBe(true);
  });

  test('works with async store', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
      store: createAsyncStore(),
    });

    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });
});

// ── Token Bucket ────────────────────────────────────────────────────

describe('TokenBucket algorithm', () => {
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => { clock = createClock(1000); });

  test('allows requests within bucket', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 5000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      const r = await limiter.consume('user1');
      expect(r.action).toBe(RateLimitAction.Allow);
      expect(r.remaining).toBe(5 - i - 1);
    }
  });

  test('denies when bucket empty with correct retryAfter', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Deny);
    expect(r.remaining).toBe(0);
    // refillRate = 2/2000 = 0.001, deficit = 1, retryAfter = ceil(1/0.001) = 1000
    expect((r as RateLimitDenyResult).retryAfter).toBe(1000);
  });

  test('refills tokens over time', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 10000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    for (let i = 0; i < 10; i++) await limiter.consume('user1');

    clock.advance(5000);
    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
    expect(r.remaining).toBe(4); // 5 refilled - 1 consumed
  });

  test('token bucket caps at limit', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 5000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    clock.advance(100000);
    const r = await limiter.consume('user1');
    expect(r.remaining).toBe(4);
  });

  test('cost=0 does not consume', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1', { cost: 0 });
    expect(r1.action).toBe(RateLimitAction.Allow);
    expect(r1.remaining).toBe(1);

    const r2 = await limiter.consume('user1');
    expect(r2.action).toBe(RateLimitAction.Allow);
    expect(r2.remaining).toBe(0);
  });

  test('cost > limit is denied on first request', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 5000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    const r = await limiter.consume('user1', { cost: 10 });
    expect(r.action).toBe(RateLimitAction.Deny);
    expect(r.remaining).toBe(0);
    // deficit = 10-5 = 5, refillRate = 5/5000 = 0.001, retryAfter = ceil(5/0.001) = 5000
    expect((r as RateLimitDenyResult).retryAfter).toBe(5000);
  });

  test('works with async store', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
      store: createAsyncStore(),
    });

    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });
});

// ── Peek ────────────────────────────────────────────────────────────

describe('peek', () => {
  test('does not consume tokens (SlidingWindow)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    // Multiple peeks should all report same state
    const peek1 = await limiter.peek('user1');
    const peek2 = await limiter.peek('user1');
    expect(peek1.action).toBe(RateLimitAction.Allow);
    expect(peek2.action).toBe(RateLimitAction.Allow);
    expect(peek1.remaining).toBe(peek2.remaining);

    // Consume, then peek should show deny
    await limiter.consume('user1');
    const peek3 = await limiter.peek('user1');
    expect(peek3.action).toBe(RateLimitAction.Deny);
  });

  test('does not consume tokens (GCRA)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    const peek1 = await limiter.peek('user1');
    expect(peek1.action).toBe(RateLimitAction.Allow);

    // Peek again - should still be Allow
    const peek2 = await limiter.peek('user1');
    expect(peek2.action).toBe(RateLimitAction.Allow);

    // Consume, then peek should show deny
    await limiter.consume('user1');
    const peek3 = await limiter.peek('user1');
    expect(peek3.action).toBe(RateLimitAction.Deny);
  });

  test('does not consume tokens (TokenBucket)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    const peek1 = await limiter.peek('user1');
    expect(peek1.action).toBe(RateLimitAction.Allow);
    // remaining = available - cost = 1 - 1 = 0 (consistent with GCRA/SlidingWindow)
    expect(peek1.remaining).toBe(0);

    const peek2 = await limiter.peek('user1');
    expect(peek2.remaining).toBe(0);

    await limiter.consume('user1');
    const peek3 = await limiter.peek('user1');
    expect(peek3.action).toBe(RateLimitAction.Deny);
  });

  test('peek deny shows correct retryAfter (SlidingWindow)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    const peek = await limiter.peek('user1');
    expect(peek.action).toBe(RateLimitAction.Deny);
    expect((peek as RateLimitDenyResult).retryAfter).toBe(1000);
  });

  test('peek deny shows correct retryAfter (GCRA)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    await limiter.consume('user1');
    const peek = await limiter.peek('user1');
    expect(peek.action).toBe(RateLimitAction.Deny);
    expect((peek as RateLimitDenyResult).retryAfter).toBeGreaterThan(0);
  });

  test('peek deny shows correct retryAfter (TokenBucket)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    await limiter.consume('user1');
    const peek = await limiter.peek('user1');
    expect(peek.action).toBe(RateLimitAction.Deny);
    expect((peek as RateLimitDenyResult).retryAfter).toBe(1000);
  });
});

// ── Compound Rules ──────────────────────────────────────────────────

describe('compound rules', () => {
  test('enforces multiple rules', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 5, window: 1000 },
        { limit: 10, window: 10000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });

  test('does not consume if any rule denies (first rule)', async () => {
    const clock = createClock(1000);
    const store = new MemoryStore();
    const limiter = RateLimiter.create({
      rules: [
        { limit: 2, window: 1000 },
        { limit: 100, window: 10000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      store,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');

    const denied = await limiter.consume('user1');
    expect(denied.action).toBe(RateLimitAction.Deny);

    // After tight rule resets, loose rule still has capacity
    clock.advance(1001);
    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
  });

  test('does not consume if second rule denies', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 100, window: 10000 },
        { limit: 2, window: 1000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');

    const denied = await limiter.consume('user1');
    expect(denied.action).toBe(RateLimitAction.Deny);

    clock.advance(1001);
    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
  });

  test('returns most restrictive deny (longest retryAfter)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 1, window: 1000 },
        { limit: 1, window: 5000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    const denied = await limiter.consume('user1');
    expect(denied.action).toBe(RateLimitAction.Deny);
    // Should return the longer retryAfter (5000 > 1000)
    expect((denied as RateLimitDenyResult).retryAfter).toBe(5000);
  });

  test('returns most restrictive allow (lowest remaining)', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 10, window: 1000 },
        { limit: 3, window: 5000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
    expect(r.remaining).toBe(2); // min(9, 2) = 2
  });

  test('compound peek works', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 1, window: 1000 },
        { limit: 10, window: 10000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    expect((await limiter.peek('user1')).action).toBe(RateLimitAction.Allow);
    await limiter.consume('user1');
    expect((await limiter.peek('user1')).action).toBe(RateLimitAction.Deny);
  });
});

// ── Hooks ───────────────────────────────────────────────────────────

describe('hooks', () => {
  test('onConsume is called on Allow', async () => {
    const clock = createClock(1000);
    const calls: Array<{ key: string; result: RateLimitAllowResult }> = [];

    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: { onConsume: (key, result) => calls.push({ key, result }) },
    });

    await limiter.consume('user1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe('user1');
    expect(calls[0]!.result.action).toBe(RateLimitAction.Allow);
  });

  test('onLimit is called on Deny', async () => {
    const clock = createClock(1000);
    const calls: Array<{ key: string; result: RateLimitDenyResult }> = [];

    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: { onLimit: (key, result) => calls.push({ key, result }) },
    });

    await limiter.consume('user1');
    await limiter.consume('user1');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe('user1');
    expect(calls[0]!.result.action).toBe(RateLimitAction.Deny);
  });

  test('hooks are not called on peek', async () => {
    const clock = createClock(1000);
    let hookCalled = false;

    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onConsume: () => { hookCalled = true; },
        onLimit: () => { hookCalled = true; },
      },
    });

    await limiter.peek('user1');
    expect(hookCalled).toBe(false);
  });

  test('hook errors do not get wrapped as StoreError', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onConsume: () => { throw new Error('hook error'); },
      },
    });

    // Hook throws after successful consume — error should propagate
    // but not be wrapped as StoreError
    try {
      await limiter.consume('user1');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe('hook error');
    }
  });
});

// ── Store Error Handling ────────────────────────────────────────────

describe('store error handling', () => {
  test('wraps store errors in RateLimiterError with cause', async () => {
    const originalError = new Error('connection refused');
    const failingStore: RateLimiterStore = {
      update: () => { throw originalError; },
      get: () => { throw originalError; },
      clear: () => { throw originalError; },
    };

    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      store: failingStore,
    });

    try {
      await limiter.consume('user1');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimiterError);
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.StoreError);
      expect((e as RateLimiterError).message).toBe('connection refused');
      expect((e as RateLimiterError).cause).toBe(originalError);
    }
  });

  test('wraps async store errors in RateLimiterError', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      store: {
        update: () => Promise.reject(new Error('timeout')),
        get: () => Promise.reject(new Error('timeout')),
        clear: () => Promise.reject(new Error('timeout')),
      },
    });

    try {
      await limiter.consume('user1');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimiterError);
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.StoreError);
    }
  });

  test('wraps non-Error throws with default message', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      store: {
        update: () => { throw 'string error'; },
        get: () => { throw 'string error'; },
        clear: () => {},
      },
    });

    try {
      await limiter.consume('user1');
      expect(true).toBe(false);
    } catch (e) {
      expect((e as RateLimiterError).message).toBe('Store operation failed');
    }
  });

  test('peek wraps store errors too', async () => {
    const limiter = RateLimiter.create({
      rules: { limit: 10, window: 1000 },
      store: {
        update: () => { throw new Error('fail'); },
        get: () => { throw new Error('fail'); },
        clear: () => {},
      },
    });

    try {
      await limiter.peek('user1');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimiterError);
      expect((e as RateLimiterError).reason).toBe(RateLimiterErrorReason.StoreError);
    }
  });
});

// ── MemoryStore ─────────────────────────────────────────────────────

describe('MemoryStore', () => {
  test('get returns null for missing key', () => {
    const store = new MemoryStore();
    expect(store.get('missing')).toBeNull();
  });

  test('update creates and returns entry', () => {
    const store = new MemoryStore();
    const entry = store.update('key1', () => ({ value: 1, prev: 0, windowStart: 1000 }));
    expect(entry).toEqual({ value: 1, prev: 0, windowStart: 1000 });
    expect(store.get('key1')).toEqual({ value: 1, prev: 0, windowStart: 1000 });
  });

  test('update passes current entry to updater', () => {
    const store = new MemoryStore();
    store.update('key1', () => ({ value: 1, prev: 0, windowStart: 1000 }));

    let received: StoreEntry | null = null;
    store.update('key1', (current) => {
      received = current;
      return { value: 2, prev: 0, windowStart: 1000 };
    });
    expect(received).toEqual({ value: 1, prev: 0, windowStart: 1000 });
  });

  test('clear removes all entries', () => {
    const store = new MemoryStore();
    store.update('key1', () => ({ value: 1, prev: 0, windowStart: 0 }));
    store.update('key2', () => ({ value: 2, prev: 0, windowStart: 0 }));
    store.clear();
    expect(store.get('key1')).toBeNull();
    expect(store.get('key2')).toBeNull();
  });
});

// ── WithFallbackStore ───────────────────────────────────────────────

describe('WithFallbackStore', () => {
  test('uses primary store by default', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = withFallback(primary, fallback, {
      healthCheck: async () => true,
      restoreInterval: 60_000,
    });

    await store.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    expect(primary.get('key')).toEqual({ value: 1, prev: 0, windowStart: 0 });
    expect(fallback.get('key')).toBeNull();
    store.dispose();
  });

  test('falls back when primary fails', async () => {
    const primary: RateLimiterStore = {
      update: () => { throw new Error('down'); },
      get: () => { throw new Error('down'); },
      clear: () => {},
    };
    const fallback = new MemoryStore();

    const store = withFallback(primary, fallback, {
      healthCheck: async () => false,
      restoreInterval: 60_000,
    });

    await store.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    expect(fallback.get('key')).toEqual({ value: 1, prev: 0, windowStart: 0 });

    const entry = await store.get('key');
    expect(entry).toEqual({ value: 1, prev: 0, windowStart: 0 });
    store.dispose();
  });

  test('clear calls both stores', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = withFallback(primary, fallback, {
      healthCheck: async () => true,
      restoreInterval: 60_000,
    });

    primary.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    fallback.update('key', () => ({ value: 2, prev: 0, windowStart: 0 }));
    await store.clear();
    expect(primary.get('key')).toBeNull();
    expect(fallback.get('key')).toBeNull();
    store.dispose();
  });

  test('dispose stops health check timer', () => {
    const store = withFallback(new MemoryStore(), new MemoryStore(), {
      healthCheck: async () => true,
      restoreInterval: 100,
    });
    store.dispose();
    store.dispose(); // idempotent
  });

  test('restores to primary when health check passes', async () => {
    let healthy = false;
    const primary = new MemoryStore();
    const fallback = new MemoryStore();

    const store = withFallback(primary, fallback, {
      healthCheck: async () => healthy,
      restoreInterval: 50,
    });

    // Force primary to fail by making update throw
    const origUpdate = primary.update.bind(primary);
    primary.update = () => { throw new Error('down'); };

    await store.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    expect(fallback.get('key')).toEqual({ value: 1, prev: 0, windowStart: 0 });

    // Restore primary
    primary.update = origUpdate;
    healthy = true;

    // Wait for restore interval to fire
    await new Promise(resolve => setTimeout(resolve, 80));

    // Now primary should be active again
    await store.update('key2', () => ({ value: 2, prev: 0, windowStart: 0 }));
    expect(primary.get('key2')).toEqual({ value: 2, prev: 0, windowStart: 0 });

    store.dispose();
  });

  test('stays on fallback when health check throws', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();

    const store = withFallback(primary, fallback, {
      healthCheck: async () => { throw new Error('check failed'); },
      restoreInterval: 50,
    });

    // Force fallback
    const origUpdate = primary.update.bind(primary);
    primary.update = () => { throw new Error('down'); };
    await store.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));

    primary.update = origUpdate;

    // Wait for restore — should fail because healthCheck throws
    await new Promise(resolve => setTimeout(resolve, 80));

    // Still on fallback
    await store.update('key2', () => ({ value: 2, prev: 0, windowStart: 0 }));
    expect(fallback.get('key2')).toEqual({ value: 2, prev: 0, windowStart: 0 });

    store.dispose();
  });
});

// ── Default options ─────────────────────────────────────────────────

describe('default options', () => {
  test('defaults to SlidingWindow, cost=1, MemoryStore', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 1000 },
      clock: clock.now,
    });

    const r1 = await limiter.consume('user1');
    expect(r1.action).toBe(RateLimitAction.Allow);

    const r2 = await limiter.consume('user1');
    expect(r2.remaining).toBe(0);
  });
});

// ── Result shape ────────────────────────────────────────────────────

describe('result shape', () => {
  test('Allow result has correct shape', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Allow);
    expect(typeof r.remaining).toBe('number');
    expect(r.limit).toBe(5);
    expect(typeof r.resetAt).toBe('number');
    expect(r).not.toHaveProperty('retryAfter');
  });

  test('Deny result has correct shape', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1, window: 1000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    const r = await limiter.consume('user1');
    expect(r.action).toBe(RateLimitAction.Deny);
    expect(r.remaining).toBe(0);
    expect(r.limit).toBe(1);
    expect(typeof r.resetAt).toBe('number');
    expect(typeof (r as RateLimitDenyResult).retryAfter).toBe('number');
    expect((r as RateLimitDenyResult).retryAfter).toBeGreaterThan(0);
  });
});

// ── RateLimiterError ────────────────────────────────────────────────

describe('RateLimiterError', () => {
  test('has correct name, reason, and cause', () => {
    const cause = new Error('original');
    const error = new RateLimiterError(
      { reason: RateLimiterErrorReason.StoreError, message: 'test message' },
      { cause },
    );

    expect(error.name).toBe('RateLimiterError');
    expect(error.reason).toBe(RateLimiterErrorReason.StoreError);
    expect(error.message).toBe('test message');
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(Error);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

describe('edge cases', () => {
  test('handles rapid sequential consumes', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 100, window: 10000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    for (let i = 0; i < 100; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });

  test('handles very large limit', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: { limit: 1_000_000, window: 60_000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const r = await limiter.consume('user1');
    expect(r.remaining).toBe(999_999);
  });

  test('single rule array uses fast path', async () => {
    const clock = createClock(1000);
    const limiter = RateLimiter.create({
      rules: [{ limit: 2, window: 1000 }],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    await limiter.consume('user1');
    await limiter.consume('user1');
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
  });
});
