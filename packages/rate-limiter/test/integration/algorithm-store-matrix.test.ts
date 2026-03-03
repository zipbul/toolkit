import { describe, test, expect } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { MemoryStore } from '../../src/stores/memory';
import { createClock, createAsyncStore } from '../helpers';

const algorithms = [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket] as const;
const storeFactories = [
  { name: 'MemoryStore (sync)', create: () => new MemoryStore() },
  { name: 'AsyncStore', create: () => createAsyncStore() },
] as const;

describe('algorithm × store matrix', () => {
  for (const algo of algorithms) {
    for (const storeFactory of storeFactories) {
      describe(`${algo} + ${storeFactory.name}`, () => {
        test('allow → deny → time pass → recovery', async () => {
          const clock = createClock(1000);
          const limiter = RateLimiter.create({
            rules: { limit: 5, window: 5000 },
            algorithm: algo,
            store: storeFactory.create(),
            clock: clock.now,
          });

          // Consume all 5
          for (let i = 0; i < 5; i++) {
            const r = await limiter.consume('user1');
            expect(r.action).toBe(RateLimitAction.Allow);
          }

          // 6th should deny
          const denied = await limiter.consume('user1');
          expect(denied.action).toBe(RateLimitAction.Deny);

          // Advance full window
          clock.advance(5001);

          // Should recover
          const recovered = await limiter.consume('user1');
          expect(recovered.action).toBe(RateLimitAction.Allow);
        });

        test('peek matches consume outcome', async () => {
          const clock = createClock(1000);
          const limiter = RateLimiter.create({
            rules: { limit: 2, window: 2000 },
            algorithm: algo,
            store: storeFactory.create(),
            clock: clock.now,
          });

          // Peek before any consume — should allow
          const peekBefore = await limiter.peek('user1');
          expect(peekBefore.action).toBe(RateLimitAction.Allow);

          // Exhaust limit
          await limiter.consume('user1');
          await limiter.consume('user1');

          // Peek after exhaust — should deny
          const peekAfter = await limiter.peek('user1');
          expect(peekAfter.action).toBe(RateLimitAction.Deny);

          // Consume confirms deny
          const consumeAfter = await limiter.consume('user1');
          expect(consumeAfter.action).toBe(RateLimitAction.Deny);
        });

        test('reset restores full capacity', async () => {
          const clock = createClock(1000);
          const limiter = RateLimiter.create({
            rules: { limit: 1, window: 5000 },
            algorithm: algo,
            store: storeFactory.create(),
            clock: clock.now,
          });

          await limiter.consume('user1');
          expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

          await limiter.reset('user1');

          const after = await limiter.consume('user1');
          expect(after.action).toBe(RateLimitAction.Allow);
        });
      });
    }
  }
});
