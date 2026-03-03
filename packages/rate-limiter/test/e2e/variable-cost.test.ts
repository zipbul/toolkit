import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { createClock } from '../helpers';

describe('variable cost patterns', () => {
  for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
    describe(algo, () => {
      test('mixed costs exhaust limit precisely', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 20, window: 10000 },
          algorithm: algo,
          clock: clock.now,
        });

        // cost: 1+1+5+3+10 = 20
        const r1 = await limiter.consume('user1', { cost: 1 });
        expect(r1.action).toBe(RateLimitAction.Allow);
        expect(r1.remaining).toBe(19);

        const r2 = await limiter.consume('user1', { cost: 1 });
        expect(r2.action).toBe(RateLimitAction.Allow);
        expect(r2.remaining).toBe(18);

        const r3 = await limiter.consume('user1', { cost: 5 });
        expect(r3.action).toBe(RateLimitAction.Allow);
        expect(r3.remaining).toBe(13);

        const r4 = await limiter.consume('user1', { cost: 3 });
        expect(r4.action).toBe(RateLimitAction.Allow);
        expect(r4.remaining).toBe(10);

        const r5 = await limiter.consume('user1', { cost: 10 });
        expect(r5.action).toBe(RateLimitAction.Allow);
        expect(r5.remaining).toBe(0);

        // Next cost:1 should deny
        const denied = await limiter.consume('user1', { cost: 1 });
        expect(denied.action).toBe(RateLimitAction.Deny);
      });

      test('cost:0 does not affect state', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 5, window: 5000 },
          algorithm: algo,
          clock: clock.now,
        });

        // cost:0 multiple times
        for (let i = 0; i < 100; i++) {
          const r = await limiter.consume('user1', { cost: 0 });
          expect(r.action).toBe(RateLimitAction.Allow);
        }

        // Full capacity still available
        for (let i = 0; i < 5; i++) {
          expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
        }
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
      });

      test('high cost denied on first request, low cost still works', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 5, window: 5000 },
          algorithm: algo,
          clock: clock.now,
        });

        // cost:10 > limit:5 → denied
        const denied = await limiter.consume('user1', { cost: 10 });
        expect(denied.action).toBe(RateLimitAction.Deny);

        // cost:1 should still work (high cost deny shouldn't corrupt state)
        const allowed = await limiter.consume('user1', { cost: 1 });
        expect(allowed.action).toBe(RateLimitAction.Allow);
      });

      test('endpoint-weighted pattern (GET=1, POST=5, DELETE=10)', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 50, window: 60000 },
          algorithm: algo,
          clock: clock.now,
        });

        // Simulate API pattern: 30 GETs + 2 POSTs + 1 DELETE = 30+10+10 = 50
        for (let i = 0; i < 30; i++) {
          expect((await limiter.consume('user1', { cost: 1 })).action).toBe(RateLimitAction.Allow);
        }
        expect((await limiter.consume('user1', { cost: 5 })).action).toBe(RateLimitAction.Allow);
        expect((await limiter.consume('user1', { cost: 5 })).action).toBe(RateLimitAction.Allow);
        expect((await limiter.consume('user1', { cost: 10 })).action).toBe(RateLimitAction.Allow);

        // Limit reached — even a GET is denied
        expect((await limiter.consume('user1', { cost: 1 })).action).toBe(RateLimitAction.Deny);
      });
    });
  }
});
