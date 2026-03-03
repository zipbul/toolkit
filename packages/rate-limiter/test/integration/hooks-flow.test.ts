import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import type { RateLimitAllowResult, RateLimitDenyResult } from '../../src/interfaces';
import { createClock } from '../helpers';

describe('hooks in compound rules flow', () => {
  test('onConsume fires once per compound allow with most-restrictive result', async () => {
    const clock = createClock(1000);
    const consumeCalls: Array<{ key: string; result: RateLimitAllowResult }> = [];

    const limiter = RateLimiter.create({
      rules: [
        { limit: 10, window: 10000 },
        { limit: 3, window: 3000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onConsume: (key, result) => consumeCalls.push({ key, result }),
      },
    });

    await limiter.consume('user1');

    expect(consumeCalls).toHaveLength(1);
    expect(consumeCalls[0]!.key).toBe('user1');
    expect(consumeCalls[0]!.result.action).toBe(RateLimitAction.Allow);
    // Should return the most restrictive remaining (from the tighter rule)
    expect(consumeCalls[0]!.result.remaining).toBe(2);
  });

  test('onLimit fires once per compound deny with most-restrictive result', async () => {
    const clock = createClock(1000);
    const limitCalls: Array<{ key: string; result: RateLimitDenyResult }> = [];

    const limiter = RateLimiter.create({
      rules: [
        { limit: 1, window: 1000 },
        { limit: 1, window: 5000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onLimit: (key, result) => limitCalls.push({ key, result }),
      },
    });

    await limiter.consume('user1');
    await limiter.consume('user1'); // denied

    expect(limitCalls).toHaveLength(1);
    expect(limitCalls[0]!.key).toBe('user1');
    expect(limitCalls[0]!.result.action).toBe(RateLimitAction.Deny);
    // Most restrictive = longest retryAfter (5000ms rule)
    expect(limitCalls[0]!.result.retryAfter).toBe(5000);
  });

  test('hooks track full allow → deny → recovery lifecycle', async () => {
    const clock = createClock(1000);
    const events: Array<{ type: 'consume' | 'limit'; key: string }> = [];

    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 2000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onConsume: (key) => events.push({ type: 'consume', key }),
        onLimit: (key) => events.push({ type: 'limit', key }),
      },
    });

    await limiter.consume('user1'); // allow
    await limiter.consume('user1'); // allow
    await limiter.consume('user1'); // deny
    clock.advance(2001);
    await limiter.consume('user1'); // allow (recovered)

    expect(events).toEqual([
      { type: 'consume', key: 'user1' },
      { type: 'consume', key: 'user1' },
      { type: 'limit', key: 'user1' },
      { type: 'consume', key: 'user1' },
    ]);
  });

  test('peek never triggers hooks', async () => {
    const clock = createClock(1000);
    let hookCalled = false;

    const limiter = RateLimiter.create({
      rules: [
        { limit: 5, window: 5000 },
        { limit: 10, window: 10000 },
      ],
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      hooks: {
        onConsume: () => { hookCalled = true; },
        onLimit: () => { hookCalled = true; },
      },
    });

    await limiter.peek('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.peek('user1'); // deny peek

    // Only consume calls should have triggered hooks, not peeks
    hookCalled = false;
    await limiter.peek('user1');
    expect(hookCalled).toBe(false);
  });
});
