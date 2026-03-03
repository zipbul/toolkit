import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { createClock } from '../helpers';

describe('multi-tenant isolation', () => {
  test('10 tenants with independent rate limits', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules: { limit: 3, window: 5000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    const tenants = Array.from({ length: 10 }, (_, i) => `tenant-${i}`);

    // Each tenant consumes a different number of requests
    for (let t = 0; t < tenants.length; t++) {
      for (let i = 0; i <= t % 4; i++) {
        await limiter.consume(tenants[t]!);
      }
    }

    // Verify each tenant's state independently
    for (let t = 0; t < tenants.length; t++) {
      const consumed = (t % 4) + 1;
      const peek = await limiter.peek(tenants[t]!);

      if (consumed >= 3) {
        expect(peek.action).toBe(RateLimitAction.Deny);
      } else {
        expect(peek.action).toBe(RateLimitAction.Allow);
      }
    }
  });

  test('resetting one tenant does not affect others', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 5000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    // Exhaust both tenants
    await limiter.consume('tenant-a');
    await limiter.consume('tenant-a');
    await limiter.consume('tenant-b');
    await limiter.consume('tenant-b');

    expect((await limiter.consume('tenant-a')).action).toBe(RateLimitAction.Deny);
    expect((await limiter.consume('tenant-b')).action).toBe(RateLimitAction.Deny);

    // Reset only tenant-a
    await limiter.reset('tenant-a');

    expect((await limiter.consume('tenant-a')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('tenant-b')).action).toBe(RateLimitAction.Deny);
  });

  test('compound rules isolate tenants with keyed sub-rules', async () => {
    const clock = createClock(10000);
    const limiter = RateLimiter.create({
      rules: [
        { limit: 2, window: 1000 },
        { limit: 10, window: 10000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
    });

    // Exhaust tenant-a's tight rule
    await limiter.consume('tenant-a');
    await limiter.consume('tenant-a');
    expect((await limiter.consume('tenant-a')).action).toBe(RateLimitAction.Deny);

    // tenant-b should be unaffected
    expect((await limiter.consume('tenant-b')).action).toBe(RateLimitAction.Allow);
    expect((await limiter.consume('tenant-b')).action).toBe(RateLimitAction.Allow);
  });
});
