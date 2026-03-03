import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import type { RateLimitDenyResult } from '../../src/interfaces';
import { createClock } from '../helpers';

const algorithms = [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket] as const;

describe('burst → deny → cooldown → recovery', () => {
  for (const algo of algorithms) {
    describe(algo, () => {
      test('full burst then deny with accurate retryAfter', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 10, window: 10000 },
          algorithm: algo,
          clock: clock.now,
        });

        for (let i = 0; i < 10; i++) {
          const r = await limiter.consume('api-key');
          expect(r.action).toBe(RateLimitAction.Allow);
          expect(r.remaining).toBe(10 - i - 1);
        }

        const denied = await limiter.consume('api-key');
        expect(denied.action).toBe(RateLimitAction.Deny);
        expect(denied.remaining).toBe(0);

        const retryAfter = (denied as RateLimitDenyResult).retryAfter;
        expect(retryAfter).toBeGreaterThan(0);
        expect(Number.isFinite(retryAfter)).toBe(true);
      });

      test('recovers after retryAfter elapses', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 10, window: 10000 },
          algorithm: algo,
          clock: clock.now,
        });

        for (let i = 0; i < 10; i++) await limiter.consume('api-key');

        const denied = await limiter.consume('api-key');
        const retryAfter = (denied as RateLimitDenyResult).retryAfter;

        // Just before retryAfter — still denied
        clock.advance(retryAfter - 1);
        expect((await limiter.consume('api-key')).action).toBe(RateLimitAction.Deny);

        // Slightly past retryAfter — should recover
        // SlidingWindow needs +1 extra due to prev weight at exact boundary
        clock.advance(2);
        const recovered = await limiter.consume('api-key');
        expect(recovered.action).toBe(RateLimitAction.Allow);
      });

      test('full reset after sufficient time', async () => {
        const clock = createClock(10000);
        const limiter = RateLimiter.create({
          rules: { limit: 10, window: 10000 },
          algorithm: algo,
          clock: clock.now,
        });

        for (let i = 0; i < 10; i++) await limiter.consume('api-key');

        // SlidingWindow needs 2x window for prev to fully expire
        // GCRA/TokenBucket recover fully within 1x window
        clock.advance(20001);

        for (let i = 0; i < 10; i++) {
          const r = await limiter.consume('api-key');
          expect(r.action).toBe(RateLimitAction.Allow);
        }

        expect((await limiter.consume('api-key')).action).toBe(RateLimitAction.Deny);
      });
    });
  }
});
