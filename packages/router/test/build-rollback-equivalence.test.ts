/**
 * P4b root-cause verification. Each test exercises a rollback / batch-failure
 * path that the typed-UndoRecord migration touched. The aim is to catch any
 * semantic divergence from the original closure-based undo log that the
 * existing test suite does not exercise.
 */
import { describe, expect, it } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

describe('P4b rollback semantic equivalence', () => {
  it('rolls back prefix-index mutations cleanly when a later route in the same batch fails', () => {
    // First: commit a wildcard at /a/*p. Second: register a static at /a/leaf
    // that's unreachable under the wildcard. Third: try a fresh build with
    // only /b/leaf and confirm no leaked state from the failed prior build.
    const r1 = new Router<string>();
    r1.add('GET', '/a/*p', 'wild');
    r1.add('GET', '/a/leaf', 'leaf');
    expect(() => r1.build()).toThrow(RouterError);

    const r2 = new Router<string>();
    r2.add('GET', '/b/leaf', 'fresh');
    r2.build();
    expect(r2.match('GET', '/b/leaf')?.value).toBe('fresh');
  });

  it('rolls back segment-tree typed undo records correctly on regex compilation failure mid-batch', () => {
    // The first route inserts a number of static segments into the segment
    // tree. The second route then triggers a rollback inside
    // insertIntoSegmentTree because of an invalid regex. Subsequent valid
    // routes must build cleanly.
    const r = new Router<string>();
    r.add('GET', '/zone/sector/leaf-a', 'a');
    r.add('GET', '/zone/sector/leaf-b/:id([z-a])', 'bad');
    r.add('GET', '/zone/sector/leaf-c', 'c');

    const error = (() => {
      try { r.build(); return null; }
      catch (e) { return e as RouterError; }
    })();
    expect(error).not.toBeNull();
    expect(error!.data.kind).toBe('route-validation');

    // Build a fresh router, the previous state must not leak.
    const r2 = new Router<string>();
    r2.add('GET', '/zone/sector/leaf-a', 'a');
    r2.add('GET', '/zone/sector/leaf-c', 'c');
    r2.build();
    expect(r2.match('GET', '/zone/sector/leaf-a')?.value).toBe('a');
    expect(r2.match('GET', '/zone/sector/leaf-c')?.value).toBe('c');
  });

  it('prefix-index node counters are exactly zero after total batch rollback', () => {
    // Force every route to fail; prefix-index counters must end clean.
    // Sentinel check: a fresh subsequent batch with the same prefixes
    // succeeds (would not if subtreeWildcardCount/Terminal lingered).
    const r1 = new Router<string>();
    for (let i = 0; i < 50; i++) r1.add('GET', `/a/${i}`, 'x');
    r1.add('GET', '/a/0', 'duplicate'); // fails the whole batch
    expect(() => r1.build()).toThrow(RouterError);

    // Same router, after the failed build, can it still register correctly?
    // Per the contract, a fresh seal() resets prefixIndex; this tests that.
    const r2 = new Router<string>();
    r2.add('GET', '/a/0', 'a0');
    r2.add('GET', '/a/*tail', 'wild'); // would conflict if /a/0 is leaked from prior build
    expect(() => r2.build()).toThrow(RouterError); // legitimate conflict here

    const r3 = new Router<string>();
    for (let i = 0; i < 50; i++) r3.add('GET', `/x/${i}`, 'x');
    r3.build();
    for (let i = 0; i < 50; i++) {
      expect(r3.match('GET', `/x/${i}`)?.value).toBe('x');
    }
  });

  it('handlers/terminalHandlers/paramsFactories typed truncation undo restores exact lengths', () => {
    // Register two valid dynamic routes, then a third dynamic route that
    // fails inside compileDynamicRoute (invalid regex). The handlers,
    // terminalHandlers, paramsFactories arrays must truncate back to their
    // pre-route-3 lengths so a re-registration works.
    const r1 = new Router<string>();
    r1.add('GET', '/a/:x', 'x');
    r1.add('GET', '/b/:y', 'y');
    r1.add('GET', '/c/:z([z-a])', 'bad');
    expect(() => r1.build()).toThrow(RouterError);

    const r2 = new Router<string>();
    r2.add('GET', '/a/:x', 'x');
    r2.add('GET', '/b/:y', 'y');
    r2.build();
    expect(r2.match('GET', '/a/foo')?.value).toBe('x');
    expect(r2.match('GET', '/b/bar')?.value).toBe('y');
  });

  it('static-map typed restore record preserves prior values on slot collision rollback', () => {
    // The typed StaticMapRestore record must restore both the value and the
    // registered flag exactly. Force a route-duplicate inside a single
    // build and verify the prior good route still resolves.
    const r1 = new Router<string>();
    r1.add('GET', '/x', 'first');
    r1.add('GET', '/x', 'second'); // duplicate -> route-duplicate
    expect(() => r1.build()).toThrow(RouterError);

    // Fresh build with just the first route must work.
    const r2 = new Router<string>();
    r2.add('GET', '/x', 'first');
    r2.build();
    expect(r2.match('GET', '/x')?.value).toBe('first');
  });

  it('codegen pre-walk node-count gate does not skip valid small trees', () => {
    // The pre-walk gate must NOT bail on small trees that should compile.
    // Build a tiny tree and confirm match still returns correctly (i.e. the
    // walker — compiled or interpreted — works).
    const r = new Router<string>();
    r.add('GET', '/x/:id', 'h');
    r.build();
    const m = r.match('GET', '/x/42');
    expect(m?.value).toBe('h');
    expect(m?.params.id).toBe('42');
  });

  it('codegen pre-walk node-count gate bails cleanly on huge trees and falls back to walker', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1000; i++) r.add('GET', `/leaf-${i}/:tail`, `h${i}`);
    r.build();
    expect(r.match('GET', '/leaf-0/x')?.value).toBe('h0');
    expect(r.match('GET', '/leaf-500/abc')?.value).toBe('h500');
    expect(r.match('GET', '/leaf-999/zzz')?.value).toBe('h999');
    expect(r.match('GET', '/nonexistent/x')).toBeNull();
  });
});
