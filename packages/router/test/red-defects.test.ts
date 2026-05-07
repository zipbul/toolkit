import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

describe('method token validation', () => {
  test('empty method must throw on add()/build()', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('whitespace method "GET POST" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET POST' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with control char "GET\\t" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET\t' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with delimiter "GET/" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET/' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method longer than 64 ASCII bytes must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('A'.repeat(65) as any, '/x', 'h');
      r.build();
    }).toThrow();
  });
});

describe('registration path validation', () => {
  test('path with raw query "/a?b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a?b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with raw fragment "/a#b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a#b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with C0 control char must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a\x01b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with literal dot segment "/a/../b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/../b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with literal "." segment must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/./b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with encoded-dot segment "/%2e%2e/b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/%2e%2e/b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with malformed percent "/a/%ZZ" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/%ZZ', 'h');
      r.build();
    }).toThrow();
  });

  test('path with raw non-ASCII byte must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/한', 'h');
      r.build();
    }).toThrow();
  });
});

describe('runtime secure path policy', () => {
  test('runtime malformed percent must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%ZZ')).toBeNull();
  });

  test('runtime fragment "#" must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/foo#bar')).toBeNull();
  });

  test('runtime encoded slash %2F inside param must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/files/:name', 'h');
    r.build();
    expect(r.match('GET', '/files/a%2Fb')).toBeNull();
  });

  test('runtime encoded control %00 must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%00')).toBeNull();
  });

  test('runtime dot segment "/a/../b" must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/../b')).toBeNull();
  });

  test('runtime overlong UTF-8 %C0%AF must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%C0%AF')).toBeNull();
  });
});

describe('optionalParamBehavior: "omit"', () => {
  test('omit mode: missing optional must NOT appear as undefined key', () => {
    const r = new Router<{ id?: string }>({ optionalParamBehavior: 'omit' });
    r.add('GET', '/users/:id?', { id: undefined });
    r.build();
    const out = r.match('GET', '/users');
    expect(out).not.toBeNull();
    // RED: current code returns { id: undefined } even in omit mode
    expect('id' in (out!.params)).toBe(false);
  });

  test('set-undefined mode: missing optional MUST appear as undefined key', () => {
    const r = new Router<{ id?: string }>({ optionalParamBehavior: 'set-undefined' });
    r.add('GET', '/users/:id?', { id: undefined });
    r.build();
    const out = r.match('GET', '/users');
    expect(out).not.toBeNull();
    expect('id' in (out!.params)).toBe(true);
    expect(out!.params.id).toBeUndefined();
  });
});

describe('params cache mutation safety', () => {
  test('caller mutation of returned params must not poison later cache hits', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();

    const a = r.match('GET', '/users/42');
    expect(a).not.toBeNull();
    expect(a!.params.id).toBe('42');

    // Mutate the returned params object.
    (a!.params as any).id = 'POISONED';

    // Second match for the same path must return the original cached value.
    const b = r.match('GET', '/users/42');
    expect(b).not.toBeNull();
    expect(b!.params.id).toBe('42');
  });
});
