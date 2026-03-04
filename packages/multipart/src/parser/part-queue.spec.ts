import { describe, expect, test } from 'bun:test';

import { MultipartFieldImpl } from './part';
import { PartQueue } from './part-queue';

function field(name: string, value: string): MultipartFieldImpl {
  return new MultipartFieldImpl(name, 'text/plain', new TextEncoder().encode(value));
}

describe('PartQueue', () => {
  test('yields pushed parts in order', async () => {
    const queue = new PartQueue();

    queue.push(field('a', '1'));
    queue.push(field('b', '2'));
    queue.finish();

    const names: string[] = [];

    for await (const part of queue) {
      names.push(part.name);
    }

    expect(names).toEqual(['a', 'b']);
  });

  test('consumer waits for push then finish', async () => {
    const queue = new PartQueue();

    // Push asynchronously after a microtask
    queueMicrotask(() => {
      queue.push(field('delayed', 'val'));
      queue.finish();
    });

    const parts: string[] = [];

    for await (const part of queue) {
      parts.push(part.name);
    }

    expect(parts).toEqual(['delayed']);
  });

  test('fail() causes iteration to throw', async () => {
    const queue = new PartQueue();
    const error = new Error('parser failed');

    queueMicrotask(() => {
      queue.push(field('ok', 'val'));
      queue.fail(error);
    });

    const names: string[] = [];

    try {
      for await (const part of queue) {
        names.push(part.name);
      }

      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBe(error);
    }

    // The part pushed before fail() should still have been yielded
    expect(names).toEqual(['ok']);
  });

  test('abandoned is false during iteration, true after break', async () => {
    const queue = new PartQueue();

    queue.push(field('first', '1'));
    queue.push(field('second', '2'));

    expect(queue.abandoned).toBe(false);

    for await (const _part of queue) {
      expect(queue.abandoned).toBe(false);
      break;
    }

    expect(queue.abandoned).toBe(true);
  });

  test('empty queue with immediate finish yields nothing', async () => {
    const queue = new PartQueue();

    queue.finish();

    const parts: unknown[] = [];

    for await (const part of queue) {
      parts.push(part);
    }

    expect(parts).toHaveLength(0);
  });

  test('abandon() wakes a waiting consumer', async () => {
    const queue = new PartQueue();

    queueMicrotask(() => {
      queue.abandon();
      queue.finish();
    });

    const parts: unknown[] = [];

    for await (const part of queue) {
      parts.push(part);
    }

    expect(parts).toHaveLength(0);
  });

  test('multiple pushes before consumer reads are all yielded', async () => {
    const queue = new PartQueue();

    for (let i = 0; i < 10; i++) {
      queue.push(field(`f${i}`, `v${i}`));
    }

    queue.finish();

    let count = 0;

    for await (const _part of queue) {
      count++;
    }

    expect(count).toBe(10);
  });
});
