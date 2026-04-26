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

  it('does not throw on extremely long URLs (length-rejected)', () => {
    const r = new Router<string>({ maxPathLength: 1024 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    const path = '/users/' + 'x'.repeat(1_000_000);

    expect(() => r.match('GET', path)).not.toThrow();
    expect(r.match('GET', path)).toBeNull();
  });

  it('does not throw on malformed percent-encoded sequences', () => {
    const r = new Router<string>({ decodeParams: true });
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

// ── add() rejects malformed registration input ────────────────────────────

describe('add() rejects malformed registration input', () => {
  it('throws RouterError on duplicate route', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'first');

    expect(() => r.add('GET', '/x', 'second')).toThrow(RouterError);
  });

  it('throws RouterError on empty param name (e.g. "/:")', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/users/:', 'u')).toThrow(RouterError);
  });

  it('throws RouterError on duplicate param names within one route', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/users/:x/posts/:x', 'u')).toThrow(RouterError);
  });

  it('throws RouterError on wildcard not at end', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/files/*p/middle', 'f')).toThrow(RouterError);
  });

  it('throws RouterError on cross-method wildcard name conflict', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');

    expect(() => r.add('GET', '/files/*q', 'f2')).toThrow(RouterError);
  });

  it('throws RouterError on static route conflicting with existing wildcard prefix', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');

    expect(() => r.add('GET', '/files/static', 'sf')).toThrow(RouterError);
  });
});

// ── Regex safety + anchor policy ─────────────────────────────────────────

describe('regex safety options', () => {
  it('throws RouterError when regex pattern exceeds maxLength', () => {
    const r = new Router<string>({ regexSafety: { maxLength: 10 } });
    const longPattern = '\\d'.repeat(20); // 40 chars

    expect(() => r.add('GET', `/x/:id{${longPattern}}`, 'x')).toThrow(RouterError);
  });

  it('throws RouterError on backreference patterns by default', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/x/:id{(a)\\1}', 'x')).toThrow(RouterError);
  });

  it('rejects forbidden backtracking tokens (nested quantifiers like (a+)+ )', () => {
    const r = new Router<string>();

    // (a+)+ — classic catastrophic-backtracking nested quantifier.
    expect(() => r.add('GET', '/x/:id{(a+)+}', 'x')).toThrow(RouterError);
  });

  it('regexAnchorPolicy: error rejects ^ or $ in patterns', () => {
    const r = new Router<string>({ regexAnchorPolicy: 'error' });

    expect(() => r.add('GET', '/x/:id{^abc$}', 'x')).toThrow(RouterError);
  });

  it('regexAnchorPolicy: warn fires onWarn but does not throw', () => {
    const warnings: unknown[] = [];
    const r = new Router<string>({
      regexAnchorPolicy: 'warn',
      onWarn: w => warnings.push(w),
    });

    expect(() => r.add('GET', '/x/:id{^abc$}', 'x')).not.toThrow();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ── Regex tester runtime — timeout channel ────────────────────────────────

describe('regex tester runtime', () => {
  it('regex tester timeout: returns null and does not throw', () => {
    // maxExecutionMs forces tester to give up on slow regex.
    const r = new Router<string>({
      regexSafety: {
        maxExecutionMs: 1,
        // Allow more dangerous patterns through so we can simulate slow regex.
        forbidBacktrackingTokens: false,
        forbidBackreferences: false,
        maxLength: 200,
      },
    });

    // catastrophic backtracking pattern + matching input (well-known ReDoS)
    r.add('GET', '/x/:id{(a+)+b}', 'x');
    r.build();

    const evil = 'a'.repeat(40) + 'X'; // forces exponential backtracking
    let result: ReturnType<typeof r.match> | undefined;

    expect(() => { result = r.match('GET', `/x/${evil}`); }).not.toThrow();
    // Either match was rejected (timeout) or completed quickly with a result.
    // Critically: never throws.
    expect(result === null || (result !== undefined && typeof result.value === 'string')).toBe(true);
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
    // registration time (route-conflict) instead of silently accepting
    // a dead route.
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'first');

    expect(() => r.add('GET', '/users/:slug', 'second')).toThrow(RouterError);
  });

  it('still allows siblings from the same route via optional-param expansion', () => {
    // /users/:a?/:b? expands to four routes ALL sharing the same handler
    // index. The radix-builder records the original handler on each ParamNode
    // and skips the unreachability check when colliding siblings come from
    // the same expansion family (they all converge on the same handler).
    const r = new Router<string>();

    expect(() => r.add('GET', '/users/:a?/:b?', 'opt')).not.toThrow();
    r.build();

    expect(r.match('GET', '/users')!.value).toBe('opt');
    expect(r.match('GET', '/users/x')!.value).toBe('opt');
    expect(r.match('GET', '/users/x/y')!.value).toBe('opt');
  });

  it('allows sibling params when one has a regex tester', () => {
    // Tester-bearing siblings can legitimately distinguish at runtime.
    // /a/:id{\\d+} matches digits only; /a/:slug catches the rest. Insertion
    // order (numeric tester first) makes both reachable.
    const r = new Router<string>();
    r.add('GET', '/a/:id{\\d+}', 'numeric');

    expect(() => r.add('GET', '/a/:slug', 'catchall')).not.toThrow();
    r.build();

    expect(r.match('GET', '/a/42')!.value).toBe('numeric');
    expect(r.match('GET', '/a/hello')!.value).toBe('catchall');
  });

  it('rejects empty path (must start with "/")', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '', 'r')).toThrow(RouterError);
  });
});

// ── Cache misuse ─────────────────────────────────────────────────────────

describe('cache misuse', () => {
  it('clearCache when cache disabled is a no-op (does not throw)', () => {
    const r = new Router<string>({ enableCache: false });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(() => r.clearCache()).not.toThrow();
  });

  it('clearCache before build is a no-op (does not throw)', () => {
    const r = new Router<string>({ enableCache: true });

    expect(() => r.clearCache()).not.toThrow();
  });
});
