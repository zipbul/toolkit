/**
 * RED test fixtures for ULTIMATE.md §5.1 reproduced defects.
 *
 * Each `test` here is expected to FAIL on current code (RED). When the
 * corresponding §13 Phase implementation lands, the test must turn GREEN.
 *
 * Mapping:
 *   1. empty method                    → §13 Phase 1 (method-policy)
 *   2. whitespace method               → §13 Phase 1
 *   3. control-char method             → §13 Phase 1
 *   4. registration query `?`          → §13 Phase 1 (path-policy)
 *   5. registration fragment `#`       → §13 Phase 1
 *   6. registration control char       → §13 Phase 1
 *   7. registration dot segment        → §13 Phase 1
 *   8. registration encoded-dot        → §13 Phase 1
 *   9. registration malformed percent  → §13 Phase 1
 *  10. runtime malformed percent       → §13 Phase 2 (runtime-path-policy)
 *  11. runtime fragment `#`            → §13 Phase 2
 *  12. runtime encoded slash %2F       → §13 Phase 2
 *  13. runtime dot segment             → §13 Phase 2
 *  14. optionalParamBehavior:'omit'    → §13 Phase 3
 *  15. params cache mutation safety    → §13 Phase 3 (lock current behavior)
 *
 * To run only these:
 *   bun test test/red-defects.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

// ────────────────────────────────────────────────────────────────────────
// §13 Phase 1 — method-policy
// ────────────────────────────────────────────────────────────────────────
describe('RED: method token validation (Phase 1)', () => {
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

// ────────────────────────────────────────────────────────────────────────
// §13 Phase 1 — path-policy at registration time
// ────────────────────────────────────────────────────────────────────────
describe('RED: registration path validation (Phase 1)', () => {
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

// ────────────────────────────────────────────────────────────────────────
// §13 Phase 2 — runtime path scanner (secure/default)
// ────────────────────────────────────────────────────────────────────────
describe('RED: runtime secure path policy (Phase 2)', () => {
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

// ────────────────────────────────────────────────────────────────────────
// §13 Phase 3 — optional behavior + clone-on-hit
// ────────────────────────────────────────────────────────────────────────
describe('RED: optionalParamBehavior:"omit" (Phase 3)', () => {
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

// ────────────────────────────────────────────────────────────────────────
// §13 Phase 3 — params cache mutation safety (lock current GREEN behavior)
// ────────────────────────────────────────────────────────────────────────
describe('GREEN-lock: params cache mutation safety', () => {
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
