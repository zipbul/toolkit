/**
 * Build rollback contract.
 *
 * When `build()` fails mid-batch, every mutation made by the failed routes
 * must reverse cleanly so:
 *   - a fresh Router with the same routes minus the failing one succeeds, and
 *   - the failed router never publishes partial compiled state to match().
 *
 * Both surfaces are exercised here: typed-UndoRecord rollback (prefix-index,
 * segment-tree, handler arrays, static-map slot) plus the public-facing
 * "no handlers visible after a validation failure" guarantee.
 */
import { describe, expect, it } from 'bun:test';

import { getRouterInternals } from '../../internal';
import { RouterError } from '../../src/error';
import { Router } from '../../src/router';
import { RouterErrorKind } from '../../src/types';

const peekHandlers = (r: Router<string>): unknown[] =>
  (getRouterInternals(r).registration as unknown as { handlers?: unknown[] }).handlers ?? [];

describe('rollback semantic equivalence', () => {
  it('rolls back prefix-index mutations cleanly when a later route in the same batch fails', () => {
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
    const r = new Router<string>();
    r.add('GET', '/zone/sector/leaf-a', 'a');
    r.add('GET', '/zone/sector/leaf-b/:id([z-a])', 'bad');
    r.add('GET', '/zone/sector/leaf-c', 'c');

    const error = (() => {
      try {
        r.build();
        return null;
      } catch (e) {
        return e as RouterError;
      }
    })();
    expect(error).not.toBeNull();
    expect(error!.data.kind).toBe(RouterErrorKind.RouteValidation);

    const r2 = new Router<string>();
    r2.add('GET', '/zone/sector/leaf-a', 'a');
    r2.add('GET', '/zone/sector/leaf-c', 'c');
    r2.build();
    expect(r2.match('GET', '/zone/sector/leaf-a')?.value).toBe('a');
    expect(r2.match('GET', '/zone/sector/leaf-c')?.value).toBe('c');
  });

  it('prefix-index node counters are exactly zero after total batch rollback', () => {
    const r1 = new Router<string>();
    for (let i = 0; i < 50; i++) {
      r1.add('GET', `/a/${i}`, 'x');
    }
    r1.add('GET', '/a/0', 'duplicate');
    expect(() => r1.build()).toThrow(RouterError);

    const r2 = new Router<string>();
    r2.add('GET', '/a/0', 'a0');
    r2.add('GET', '/a/*tail', 'wild');
    expect(() => r2.build()).toThrow(RouterError);

    const r3 = new Router<string>();
    for (let i = 0; i < 50; i++) {
      r3.add('GET', `/x/${i}`, 'x');
    }
    r3.build();
    for (let i = 0; i < 50; i++) {
      expect(r3.match('GET', `/x/${i}`)?.value).toBe('x');
    }
  });

  it('handlers/terminalHandlers/paramsFactories typed truncation undo restores exact lengths', () => {
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
    const r1 = new Router<string>();
    r1.add('GET', '/x', 'first');
    r1.add('GET', '/x', 'second');
    expect(() => r1.build()).toThrow(RouterError);

    const r2 = new Router<string>();
    r2.add('GET', '/x', 'first');
    r2.build();
    expect(r2.match('GET', '/x')?.value).toBe('first');
  });

  it('codegen pre-walk node-count gate does not skip valid small trees', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:id', 'h');
    r.build();
    const m = r.match('GET', '/x/42');
    expect(m?.value).toBe('h');
    expect(m?.params.id).toBe('42');
  });

  it('codegen pre-walk node-count gate bails cleanly on huge trees and falls back to walker', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1000; i++) {
      r.add('GET', `/leaf-${i}/:tail`, `h${i}`);
    }
    r.build();
    expect(r.match('GET', '/leaf-0/x')?.value).toBe('h0');
    expect(r.match('GET', '/leaf-500/abc')?.value).toBe('h500');
    expect(r.match('GET', '/leaf-999/zzz')?.value).toBe('h999');
    expect(r.match('GET', '/nonexistent/x')).toBeNull();
  });
});

describe('handler-snapshot publication after a failed build', () => {
  it('failed build validation does not publish compiled handler slots', () => {
    const r = new Router<string>();

    r.add('GET', '/users/:id(\\d+)', 'digit');
    r.add('GET', '/users/:id([a-z]+)', 'alpha');

    let threw: unknown = null;
    try {
      r.build();
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeInstanceOf(RouterError);
    const re = threw as RouterError;
    expect(re.data.kind).toBe(RouterErrorKind.RouteValidation);
    if (re.data.kind === RouterErrorKind.RouteValidation) {
      expect(re.data.errors[0]?.error.kind).toBe(RouterErrorKind.RouteConflict);
    }

    const handlers = peekHandlers(r);
    expect(handlers.length).toBe(0);
  });

  it('failed build validation keeps compiled handler snapshot empty after many invalid routes', () => {
    const r = new Router<string>();

    r.add('GET', '/x/:id(\\d+)', 'base');
    for (let i = 0; i < 10; i++) {
      r.add('GET', '/x/:id([a-z]+)', `bad-${i}`);
    }

    expect(() => r.build()).toThrow(RouterError);

    expect(peekHandlers(r).length).toBe(0);
  });
});
