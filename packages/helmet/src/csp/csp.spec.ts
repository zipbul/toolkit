import { describe, expect, it } from 'bun:test';

import { Csp } from '../constants';

import { resolveCsp, serializeCsp, serializeCspReportOnly, validateCsp } from './serialize';

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

  it('rejects frame-ancestors with non-self/none keywords (CSP3 §6.4.2)', () => {
    // Per CSP3 §6.4.2: ancestor-source = scheme-source / host-source / "'self'"
    // No other keywords allowed.
    for (const bad of [
      "'wasm-unsafe-eval'",
      "'inline-speculation-rules'",
      "'report-sample'",
      "'strict-dynamic'",
      "'unsafe-eval'",
      "'unsafe-hashes'",
      "'unsafe-webtransport-hashes'",
      "'report-sha256'",
    ] as const) {
      const r = resolveCsp(
        { directives: { frameAncestors: [bad] } as never },
        'default-on',
      )!;
      if (r === false || r === undefined) throw new Error('expected');
      const out = validateCsp(r as never, 'csp', [], new Set());
      expect(out.some(v => v.reason === 'invalid_frame_ancestors_keyword')).toBe(true);
    }
  });

  it('rejects nonce/hash sources in frame-ancestors (CSP3 §6.4.2)', () => {
    const nonce = "'nonce-AAAAAAAAAAAAAAAA'";
    const hash = "'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'";
    for (const bad of [nonce, hash]) {
      const r = resolveCsp(
        { directives: { frameAncestors: [bad] } as never },
        'default-on',
      )!;
      if (r === false || r === undefined) throw new Error('expected');
      const out = validateCsp(r as never, 'csp', [], new Set());
      expect(out.some(v => v.reason === 'invalid_frame_ancestors_keyword')).toBe(true);
    }
  });

  it('accepts frame-ancestors with scheme/host/self', () => {
    const r = resolveCsp(
      { directives: { frameAncestors: [Csp.Self, 'https://x.com', 'https:'] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out).toEqual([]);
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

  it('rejects non-string CSP source', () => {
    const map = new Map<string, readonly unknown[] | unknown>();
    map.set('script-src', [42]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_keyword')).toBe(true);
  });

  it('rejects oversized CSP source string', () => {
    const big = 'a'.repeat(3000);
    const map = new Map<string, readonly string[]>();
    map.set('script-src', [big]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('rejects malformed nonce-source (looks like quoted keyword but not in keyword set)', () => {
    const map = new Map<string, readonly string[]>();
    // Inject a CR inside the nonce pattern. The NONCE_RE alphabet excludes
    // CR, so the source falls through to the unknown-quoted-keyword path.
    map.set('script-src', ["'nonce-AAAAAAAAAAAAA\rAA'"]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_keyword')).toBe(true);
  });

  it('rejects hash with wrong length per algorithm', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', ["'sha256-tooShortHash='"]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_hash_length')).toBe(true);
  });

  it('rejects unknown quoted keyword', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', ["'mango'"]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_keyword')).toBe(true);
  });

  it('rejects unknown host syntax', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', ['*.*.example.com']); // double-wildcard not allowed
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_host')).toBe(true);
  });

  it('webrtc accepts only allow/block', () => {
    const map = new Map<string, string>();
    map.set('webrtc', 'maybe');
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_webrtc_directive')).toBe(true);
  });

  it('upgrade-insecure-requests must be boolean', () => {
    const map = new Map<string, string>();
    map.set('upgrade-insecure-requests', 'yes');
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_keyword')).toBe(true);
  });

  it("require-trusted-types-for accepts only 'script'", () => {
    const r = resolveCsp(
      { directives: { requireTrustedTypesFor: ["'mango'"] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_require_trusted_types_token')).toBe(true);
  });

  it('trusted-types policy-name follows tt-policy-name grammar', () => {
    const r = resolveCsp(
      { directives: { trustedTypes: ['valid_name', 'bad name with spaces'] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_trusted_types_policy_name')).toBe(true);
  });

  it('sandbox accepts only the canonical 14 tokens (CSP3 §6.7.4)', () => {
    const r = resolveCsp(
      { directives: { sandbox: ['allow-forms', 'allow-bogus' as never] } },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateCsp(r as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_sandbox_token')).toBe(true);
  });

  it('rejects empty source-list directive', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', []);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'empty_fetch_directive')).toBe(true);
  });

  it('rejects too many sources per directive', () => {
    const sources = Array.from({ length: 80 }, (_, i) => `https://${i}.example`);
    const map = new Map<string, readonly string[]>();
    map.set('script-src', sources);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('rejects too many directive keys (Map-injection DoS guard)', () => {
    const map = new Map<string, readonly string[]>();
    for (let i = 0; i < 40; i++) map.set(`script-src-${i}`, [Csp.Self]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('rejects RESERVED_KEYS as directive name (prototype-pollution guard)', () => {
    const map = new Map<string, readonly string[]>();
    map.set('__proto__', [Csp.Self]);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'reserved_key_denied')).toBe(true);
  });

  it('rejects empty value for FETCH directive (defense in depth)', () => {
    const map = new Map<string, readonly string[]>();
    map.set('script-src', []);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'empty_fetch_directive')).toBe(true);
  });

  it('rejects empty form-action / base-uri (NON_FETCH_LIST_DIRECTIVES)', () => {
    const map = new Map<string, readonly string[]>();
    map.set('form-action', []);
    map.set('base-uri', []);
    map.set('default-src', [Csp.Self]); // satisfy fetch-directive check
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.filter(v => v.reason === 'empty_fetch_directive').length).toBeGreaterThanOrEqual(2);
  });

  it('rejects sandbox declared as a string (must be array)', () => {
    const map = new Map<string, string>();
    map.set('sandbox', 'allow-forms' as never);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_sandbox_token')).toBe(true);
  });

  it('rejects require-trusted-types-for declared as a string (must be array)', () => {
    const map = new Map<string, string>();
    map.set('require-trusted-types-for', "'script'" as never);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_require_trusted_types_token')).toBe(true);
  });

  it('rejects trusted-types declared as a string (must be array)', () => {
    const map = new Map<string, string>();
    map.set('trusted-types', 'foo' as never);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_trusted_types_policy_name')).toBe(true);
  });

  it('warns when trusted-types includes "default" policy', () => {
    const r = resolveCsp(
      { directives: { trustedTypes: ['default'] } as never },
      'default-on',
    )!;
    if (r === false || r === undefined) throw new Error('expected');
    const warnings: never[] = [];
    validateCsp(r as never, 'csp', warnings as never, new Set());
    expect(
      (warnings as never[]).some(
        (w: never) => (w as { reason: string }).reason === 'trusted_types_default_policy',
      ),
    ).toBe(true);
  });

  it('rejects malformed report-to name (not [A-Za-z0-9_-]+)', () => {
    const map = new Map<string, string>();
    map.set('report-to', 'has spaces');
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_report_to_group_name')).toBe(true);
  });

  it('rejects non-string report-uri', () => {
    const map = new Map<string, unknown>();
    map.set('report-uri', 42);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_report_uri')).toBe(true);
  });

  it('rejects oversized report-uri', () => {
    const huge = 'https://r.example/' + 'a'.repeat(3000);
    const map = new Map<string, string>();
    map.set('report-uri', huge);
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('serializeCspReportOnly emits the report-only header name', () => {
    const r = resolveCsp(undefined, 'default-on');
    if (r === false || r === undefined) throw new Error('expected');
    const [name] = serializeCspReportOnly(r);
    expect(name).toBe('content-security-policy-report-only');
  });

  it('serializeCsp emits boolean directives as bare keys (upgrade-insecure-requests)', () => {
    const map = new Map<string, boolean>();
    map.set('upgrade-insecure-requests', true);
    const [, value] = serializeCsp({ directives: map } as never);
    expect(value).toBe('upgrade-insecure-requests');
  });

  it('rejects source-list directive supplied as non-array (string injection)', () => {
    const map = new Map<string, string>();
    map.set('script-src', "'self'" as never); // string instead of array
    const out = validateCsp({ directives: map } as never, 'csp', [], new Set());
    expect(out.some(v => v.reason === 'invalid_csp_keyword' && v.message === 'expected an array of CSP sources')).toBe(true);
  });

  it('serializeCsp emits a bare directive name when its source list is empty', () => {
    // Bypasses validation (which would reject empty FETCH directives) by
    // constructing the resolved map directly. Exercises the empty-list arm
    // of serializeCspBody.
    const map = new Map<string, readonly string[]>();
    map.set('default-src', []);
    expect(serializeCsp({ directives: map } as never)[1]).toBe('default-src');
  });

  it('serializeCsp omits boolean false directives', () => {
    const map = new Map<string, boolean | readonly string[]>();
    map.set('upgrade-insecure-requests', false);
    map.set('script-src', [Csp.Self]);
    const [, value] = serializeCsp({ directives: map } as never);
    expect(value).toBe("script-src 'self'");
  });
});
