import { describe, it, expect } from 'bun:test';

import { Router, RouterError } from '../../index';
import { RouterErrorKind } from '../../src/types';

describe('match() tolerates structurally odd well-formed paths', () => {
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
    });
  }

  it('returns null for unknown HTTP methods (not in the registered set)', () => {
    const r = setupGenericRouter();

    expect(r.match('TRACE' as 'GET', '/health')).toBeNull();
    expect(r.match('CONNECT' as 'GET', '/users/42')).toBeNull();
  });

  it('returns null for an unregistered custom method on a known path', () => {
    const r = setupGenericRouter();
    expect(r.match('PURGE' as 'GET', '/health')).toBeNull();
  });

  it('returns null for a registered custom method on a different path', () => {
    const r = new Router<string>();
    r.add('PURGE', '/a', 'x');
    r.build();
    expect(r.match('PURGE', '/missing')).toBeNull();
    expect(r.match('MKCOL', '/a')).toBeNull();
  });

  it('returns null when match() is called before build()', () => {
    const r = new Router<string>();
    r.add('GET', '/foo', 'x');
    expect(r.match('GET', '/foo')).toBeNull();
  });

  it('does not throw on extremely long URLs', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'u');
    r.build();

    const path = '/health/' + 'x'.repeat(1_000_000);

    expect(() => r.match('GET', path)).not.toThrow();
    expect(r.match('GET', path)).toBeNull();
  });
});

describe('match() propagates URIError on malformed percent-encoded paths', () => {
  it('throws on every malformed percent-escape variant (caller responsibility)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'u');
    r.build();

    const malformed = ['/users/%', '/users/%XY', '/users/%E0', '/users/abc%'];

    for (const path of malformed) {
      expect(() => r.match('GET', path)).toThrow();
    }
  });
});

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

  it('throws RouterError when add() array partially crosses the method cap', () => {
    const r = new Router<string>();
    for (let i = 0; i < 25; i++) {
      r.add(`M${i}`, '/warm', 'x');
    }
    r.add(['GET', 'NEWMETHOD'], '/a', 'y');

    expect(() => r.build()).toThrow(RouterError);
    expect(r.match('GET', '/a')).toBeNull();
  });
});

describe('regex pattern body (regex safety is user responsibility)', () => {
  it('accepts backreference patterns (ReDoS gating is framework responsibility)', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:id((?:a)\\1)', 'x');
    expect(() => r.build()).not.toThrow();
  });

  it('accepts nested unlimited quantifiers (ReDoS gating is framework responsibility)', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:id((?:a+)+)', 'x');
    expect(() => r.build()).not.toThrow();
  });

  it('rejects ^/$ anchors at build (parser correctness — wrapper conflicts with user anchors)', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:id(^abc$)', 'x');
    expect(() => r.build()).toThrow(RouterError);
  });
});

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
    expect(err!.data.kind).toBe(RouterErrorKind.RouterSealed);
  });

  it('match() before build() returns null (does not throw)', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');

    expect(() => r.match('GET', '/x')).not.toThrow();
    expect(r.match('GET', '/x')).toBeNull();
  });
});

describe('misuse rejection', () => {
  it('rejects sibling param routes from different handlers as unreachable', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'first');
    r.add('GET', '/users/:slug', 'second');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects optional-expansion siblings whose paramName differs at the same segment position', () => {
    const r = new Router<string>();

    r.add('GET', '/users/:a?/:b?', 'opt');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects a plain param sibling adjacent to a regex param at the same segment', () => {
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

describe('optional expansion — single optional', () => {
  it('a single optional segment registers and matches both present and dropped variants', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:tail?', 'x');
    r.build();

    const present = r.match('GET', '/x/abc');
    expect(present).not.toBeNull();
    expect(present!.value).toBe('x');
    expect(present!.params.tail).toBe('abc');

    const dropped = r.match('GET', '/x');
    expect(dropped).not.toBeNull();
    expect(dropped!.value).toBe('x');
  });
});
