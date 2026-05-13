/**
 * Negative paths + exception/error code paths.
 *
 * "Happy" coverage exercises the router with valid input. This file
 * complements that with: malformed input that should be rejected, error
 * scenarios at registration time, and exception channels (regex timeout,
 * decoder failure on bad encodings, etc.) that production traffic eventually
 * encounters.
 *
 * Each test asserts the router fails *gracefully* — never throws on match()
 * (that's the contract), and throws RouterError on register-time misuse.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

// ── match() never throws regardless of bad URL input ──────────────────────

describe('match() never throws on bad input', () => {
  function setupGenericRouter() {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.add('GET', '/files/*p', 'f');
    r.add('GET', '/health', 'h');
    r.build();

    return r;
  }

  const badPaths: Array<[string, string]> = [
    ['empty string', ''],
    ['just question mark', '?'],
    ['just hash', '#'],
    ['no leading slash', 'users/42'],
    ['only slash', '/'],
    ['double slash', '//'],
    ['triple slash', '///'],
    ['NUL char in path', '/users/\u0000'],
    ['control chars', '/users/\x01\x02\x03'],
    ['only query', '/?q=1'],
    ['unicode whitespace', '/users/\u3000'],
    ['BOM at start', '\uFEFF/users/42'],
  ];

  for (const [name, path] of badPaths) {
    it(`returns a result (null or match) for ${name} without throwing`, () => {
      const r = setupGenericRouter();

      expect(() => r.match('GET', path)).not.toThrow();
      // We don't assert null — some paths may legitimately match (e.g.
      // wildcard captures unicode chars). The contract is just no throw.
    });
  }

  it('returns null for unknown HTTP methods (not in the registered set)', () => {
    const r = setupGenericRouter();

    expect(r.match('TRACE' as 'GET', '/health')).toBeNull();
    expect(r.match('CONNECT' as 'GET', '/users/42')).toBeNull();
  });

  it('does not throw on extremely long URLs', () => {
    // Router no longer caps path length anywhere — register / match must
    // tolerate absurdly long input without throwing.
    const r = new Router<string>();
    r.add('GET', '/health', 'u');
    r.build();

    const path = '/health/' + 'x'.repeat(1_000_000);

    expect(() => r.match('GET', path)).not.toThrow();
    expect(r.match('GET', path)).toBeNull();
  });

  it('does not throw on malformed percent-encoded sequences', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'u');
    r.build();

    // Each malformed: trailing %, % followed by non-hex, % half-byte
    const malformed = ['/users/%', '/users/%XY', '/users/%E0', '/users/abc%'];

    for (const path of malformed) {
      expect(() => r.match('GET', path)).not.toThrow();
      // Result may be a match with raw value or null — but never a throw.
    }
  });
});

// ── build() rejects malformed registration input ──────────────────────────

describe('build() rejects malformed registration input', () => {
  it('throws RouterError on duplicate route', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'first');
    r.add('GET', '/x', 'second');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('throws RouterError on empty param name (e.g. "/:")', () => {
    const r = new Router<string>();

    r.add('GET', '/users/:', 'u');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('throws RouterError on duplicate param names within one route', () => {
    const r = new Router<string>();

    r.add('GET', '/users/:x/posts/:x', 'u');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('throws RouterError on wildcard not at end', () => {
    const r = new Router<string>();

    r.add('GET', '/files/*p/middle', 'f');
    expect(() => r.build()).toThrow(RouterError);
  });

  // Mislabeled pre-A5 ("cross-method"): both ops are GET. After A5 (F9)
  // the conflict check is method-scoped, so this still represents the
  // same-method case that *must* still throw.
  it('throws RouterError on same-method conflicting wildcard names', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');
    r.add('GET', '/files/*q', 'f2');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('throws RouterError on static route conflicting with existing wildcard prefix', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');
    r.add('GET', '/files/static', 'sf');

    expect(() => r.build()).toThrow(RouterError);
  });
});

// ── Regex safety (always-on hardcoded guards) ────────────────────────────

describe('regex safety', () => {
  it('throws RouterError on backreference patterns', () => {
    const r = new Router<string>();

    r.add('GET', '/x/:id((a)\\1)', 'x');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects nested unlimited quantifiers (catastrophic-backtracking)', () => {
    const r = new Router<string>();

    r.add('GET', '/x/:id((a+)+)', 'x');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('strips ^/$ anchors silently (always-on)', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/x/:id(^abc$)', 'x')).not.toThrow();
    r.build();

    // Anchors stripped → :id(abc) — exact-match only.
    expect(r.match('GET', '/x/abc')!.value).toBe('x');
    expect(r.match('GET', '/x/abcd')).toBeNull();
  });
});

// ── State transition errors ──────────────────────────────────────────────

describe('state transition errors', () => {
  it('add() after build() throws RouterError', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');
    r.build();

    let err: RouterError | undefined;
    try {
      r.add('GET', '/y', 'b');
    } catch (e) {
      err = e as RouterError;
    }

    expect(err).toBeInstanceOf(RouterError);
    expect(err!.data.kind).toBe('router-sealed');
  });

  it('match() before build() returns null (does not throw)', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');

    // No build() called
    expect(() => r.match('GET', '/x')).not.toThrow();
    expect(r.match('GET', '/x')).toBeNull();
  });
});

// ── Misuse of optional params and wildcards ───────────────────────────────

describe('misuse rejection', () => {
  it('rejects sibling param routes from different handlers as unreachable', () => {
    // Two routes registered separately landing at the same param position
    // with different names — the second is unreachable because the first
    // has no regex tester and matches every value. We surface this at
    // build time (route-conflict) instead of silently accepting
    // a dead route.
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'first');
    r.add('GET', '/users/:slug', 'second');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects optional-expansion siblings whose paramName differs at the same segment position', () => {
    // /users/:a?/:b? expands to four concrete routes; two of them place
    // different paramNames at the same segment position. The prefix index
    // policy rejects this as route-duplicate at build time so matching is
    // never order-dependent.
    const r = new Router<string>();

    r.add('GET', '/users/:a?/:b?', 'opt');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects a plain param sibling adjacent to a regex param at the same segment', () => {
    // /a/:id(\\d+) registers a regex param edge. A subsequent /a/:slug
    // would shadow that edge order-dependently; the prefix index rejects
    // this as route-conflict so collision-class is order-independent.
    const r = new Router<string>();
    r.add('GET', '/a/:id(\\d+)', 'numeric');
    r.add('GET', '/a/:slug', 'catchall');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects empty path (must start with "/")', () => {
    const r = new Router<string>();

    r.add('GET', '', 'r');
    expect(() => r.build()).toThrow(RouterError);
  });
});
