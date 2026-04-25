import { describe, expect, it } from 'bun:test';

import { Csp } from '../constants';

import { resolveCsp, serializeCsp, validateCsp } from './serialize';

describe('csp/resolve', () => {
  it('OWASP defaults are emitted in canonical order', () => {
    const r = resolveCsp(undefined, 'default-on');
    if (r === false || r === undefined) throw new Error('expected resolved');
    const [, value] = serializeCsp(r);
    expect(value).toBe(
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; object-src 'none'; upgrade-insecure-requests",
    );
  });

  it('replaces directive (not merges)', () => {
    const r = resolveCsp({ directives: { scriptSrc: [Csp.Self, 'https://x.com'] } }, 'default-on');
    if (r === false || r === undefined) throw new Error('expected');
    const [, value] = serializeCsp(r);
    expect(value).toContain("script-src 'self' https://x.com");
  });

  it('returns false when input is false', () => {
    expect(resolveCsp(false, 'default-on')).toBe(false);
  });

  it('returns undefined for report-only when input is undefined', () => {
    expect(resolveCsp(undefined, 'report-only')).toBe(undefined);
  });
});

describe('csp/validate', () => {
  it('rejects bare keyword', () => {
    const r = resolveCsp({ directives: { scriptSrc: ['self'] } }, 'default-on')!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'unquoted_csp_keyword')).toBe(true);
  });

  it('rejects deprecated directive via raw key', () => {
    const r = resolveCsp(
      { directives: { defaultSrc: [Csp.Self] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    // Inject a deprecated directive directly into the resolved map.
    const map = new Map(r.directives);
    map.set('plugin-types', 'application/pdf' as never);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'deprecated_csp_directive')).toBe(true);
  });

  it('rejects frame-ancestors with unsafe-inline', () => {
    const r = resolveCsp(
      { directives: { frameAncestors: [Csp.UnsafeInline] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_frame_ancestors_keyword')).toBe(true);
  });

  it('warns when manifest-src missing under default-src', () => {
    const r = resolveCsp(
      { directives: { defaultSrc: [Csp.Self], manifestSrc: undefined as never } },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    // Force missing manifest-src
    const map = new Map(r.directives);
    map.delete('manifest-src');
    const warnings: never[] = [];
    validateCsp({ directives: map } as never, 'csp', warnings as never, new Set());
    expect((warnings as never[]).some((w: never) => (w as { reason: string }).reason === 'manifest_src_no_fallback')).toBe(true);
  });

  it('warns on unsafe-inline + nonce coexistence', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', [Csp.UnsafeInline, "'nonce-abc1234567890123456'"]);
    const warnings: never[] = [];
    validateCsp({ directives: map } as never, 'csp', warnings as never, new Set());
    expect((warnings as never[]).some((w: never) => (w as { reason: string }).reason === 'unsafe_inline_with_nonce')).toBe(true);
  });

  it('cross-references report-to with known endpoints', () => {
    const map = new Map<string, readonly string[] | string>();
    map.set('default-src', [Csp.Self]);
    map.set('report-to', 'unknown-group');
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'unknown_reporting_endpoint')).toBe(true);

    const out2 = validateCsp({ directives: map } as never, 'csp', [], new Set(['unknown-group']));
    expect(out2.some(v => v.reason === 'unknown_reporting_endpoint')).toBe(false);
  });
});
