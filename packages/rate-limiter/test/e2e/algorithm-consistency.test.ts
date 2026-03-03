import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { createClock } from '../helpers';

describe('algorithm consistency', () => {
  test('same rule + same burst → identical allow/deny boundary', async () => {
    // All algorithms should allow exactly `limit` requests and deny the next
    for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
      const clock = createClock(10000);
      const limiter = RateLimiter.create({
        rules: { limit: 10, window: 10000 },
        algorithm: algo,
        clock: clock.now,
      });

      for (let i = 0; i < 10; i++) {
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      }
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
    }
  });

  test('all algorithms recover capacity after partial window', async () => {
    // After consuming 8/10 and waiting 30% of window, all should allow at least 2 more
    // and remaining must be non-negative
    for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
      const clock = createClock(10000);
      const limiter = RateLimiter.create({
        rules: { limit: 10, window: 10000 },
        algorithm: algo,
        clock: clock.now,
      });

      for (let i = 0; i < 8; i++) await limiter.consume('user1');

      clock.advance(3000);

      // All algorithms should allow at least 2 more:
      //   SlidingWindow: 8 consumed in current window, 2 remaining
      //   TokenBucket: 2 remaining + 3 refilled = 5
      //   GCRA: 3 emissions recovered = 5 remaining
      const r1 = await limiter.consume('user1');
      expect(r1.action).toBe(RateLimitAction.Allow);
      expect(r1.remaining).toBeGreaterThanOrEqual(0);

      const r2 = await limiter.consume('user1');
      expect(r2.action).toBe(RateLimitAction.Allow);
      expect(r2.remaining).toBeGreaterThanOrEqual(0);
      expect(r2.remaining).toBeLessThan(r1.remaining);
    }
  });

  test('all algorithms deny identically when over limit at same time', async () => {
    for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
      const clock = createClock(10000);
      const limiter = RateLimiter.create({
        rules: { limit: 3, window: 5000 },
        algorithm: algo,
        clock: clock.now,
      });

      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
    }
  });

  test('all algorithms recover after 2x window (full reset)', async () => {
    for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
      const clock = createClock(10000);
      const limiter = RateLimiter.create({
        rules: { limit: 5, window: 5000 },
        algorithm: algo,
        clock: clock.now,
      });

      for (let i = 0; i < 5; i++) await limiter.consume('user1');
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

      // 2x window ensures even SlidingWindow's prev weight fully expires
      clock.advance(10001);

      for (let i = 0; i < 5; i++) {
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      }
    }
  });
});
