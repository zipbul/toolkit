import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { createClock } from '../helpers';

describe('compound rules realistic timeline', () => {
  // Rule: 5 per second + 20 per 10 seconds
  const rules = [
    { limit: 5, window: 1000 },
    { limit: 20, window: 10000 },
  ];

  test('SlidingWindow: tight rule blocks before global exhaustion', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules,
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    // Phase 1: 5 burst (second limit exhausted)
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

    // Phase 2: Wait 2x tight window for SlidingWindow prev to decay
    clock.advance(2001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

    // Phase 3: Wait 2x again, consume 5 more (total 15)
    clock.advance(2001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }

    // Phase 4: Wait 2x, consume 5 more (total 20 = global limit)
    clock.advance(2001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }

    // Phase 5: Even after tight rule recovery, global limit blocks
    clock.advance(2001);
    const globalDenied = await limiter.consume('user1');
    expect(globalDenied.action).toBe(RateLimitAction.Deny);

    // Phase 6: Wait for global window to fully expire (2x for SlidingWindow)
    clock.advance(20001);
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
  });

  test('TokenBucket: continuous refill with compound limits eventually hits global deny', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules,
      algorithm: Algorithm.TokenBucket,
      clock: clock.now,
    });

    // TokenBucket refill rates:
    //   tight: 5/1000ms = 0.005/ms (5 tokens/s)
    //   global: 20/10000ms = 0.002/ms (2 tokens/s)
    // Strategy: burst 5 per second — tight fully refills each second,
    // but global only refills 2/s so it drains by ~3/s net.

    let totalAllowed = 0;

    // Keep consuming in bursts of 5 per second until global blocks
    for (let phase = 0; phase < 10; phase++) {
      if (phase > 0) clock.advance(1000);
      for (let i = 0; i < 5; i++) {
        const r = await limiter.consume('user1');
        if (r.action === RateLimitAction.Allow) {
          totalAllowed++;
        } else {
          // Global rule finally blocked — tight had tokens but global didn't
          expect(r.action).toBe(RateLimitAction.Deny);
          // Should have consumed more than 20 (initial) due to continuous refills
          expect(totalAllowed).toBeGreaterThan(20);
          return;
        }
      }
    }

    // Should have been denied before exhausting all phases
    throw new Error(`Expected global deny but allowed ${totalAllowed} requests`);
  });

  test('GCRA: burst offset governs compound recovery', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules,
      algorithm: Algorithm.GCRA,
      clock: clock.now,
    });

    // Phase 1: Burst 5
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

    // Phase 2: Wait for tight rule recovery
    // GCRA tight: emission=200ms, burst=1000ms. After 5, TAT=10000+1000=11000.
    // At t=11001: newTat=max(11000,11001)+200=11201, allowAt=11201-1000=10201 ≤ 11001 → Allow
    clock.advance(1001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }

    // Phase 3: Accumulate more on global rule
    clock.advance(1001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }

    // 15 consumed on global. GCRA global: emission=500ms.
    // TAT for global is advancing. After sufficient accumulation, it blocks.
    clock.advance(1001);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
    }
    // 20 on global.

    // Eventually global blocks. But GCRA's burst allows ahead-of-time consumption.
    // After 4s of consuming, TAT for global is far ahead.
    // At some point a consume will be denied by the global rule.
    // Keep consuming until denied
    clock.advance(1001);
    let deniedCount = 0;
    for (let i = 0; i < 10; i++) {
      const r = await limiter.consume('user1');
      if (r.action === RateLimitAction.Deny) deniedCount++;
    }
    // Tight rule allows 5 (TAT recovers after 1001ms), then denies remaining 5
    expect(deniedCount).toBe(5);
  });
});
