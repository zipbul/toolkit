/**
 * DoS guard: optional-param expansion is `2^N`. Without a cap, a single
 * route with 20 optionals hangs the build for ~5 seconds; 25 allocates
 * tens of millions of parts arrays and OOMs on smaller hosts.
 *
 * Cap is 10 (1024 expansions, milliseconds-level build).
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

describe('optional-param expansion guard', () => {
  it('rejects 10 optionals with distinct paramNames at build (paramName collision)', () => {
    // Per the prefix-index policy: same-position different-name plain params
    // emit route-duplicate. A 10-distinct-name optional pattern is illegal
    // even though the expansion count (1024) is under the cap.
    const r = new Router<number>();
    let path = '/x';
    for (let i = 0; i < 10; i++) path += `/:p${i}?`;

    r.add('GET', path, 1);
    expect(() => r.build()).toThrow();
  });

  it('rejects 11 optionals at build validation time', () => {
    const r = new Router<number>();
    let path = '/x';
    for (let i = 0; i < 11; i++) path += `/:p${i}?`;

    let err: RouterError | undefined;
    try {
      r.add('GET', path, 1);
      r.build();
    } catch (e) {
      err = e as RouterError;
    }

    expect(err).toBeInstanceOf(RouterError);
    expect(err!.data.kind).toBe('route-validation');
    if (err!.data.kind === 'route-validation') {
      expect(err!.data.errors[0]?.error.kind).toBe('optional-expansion-limit');
      expect(err!.data.errors[0]?.error.message).toContain('optional');
    }
  });

  it('rejects 20 optionals quickly (no 5-second hang)', () => {
    const r = new Router<number>();
    let path = '/x';
    for (let i = 0; i < 20; i++) path += `/:p${i}?`;

    const t0 = performance.now();
    let threw = false;
    try {
      r.add('GET', path, 1);
      r.build();
    } catch {
      threw = true;
    }
    const t1 = performance.now();

    expect(threw).toBe(true);
    // Without the guard this would take ~5000ms. With the guard, the
    // detection runs in O(N) on parts before any expansion — well under
    // 10ms even on a slow host.
    expect(t1 - t0).toBeLessThan(50);
  });
});
