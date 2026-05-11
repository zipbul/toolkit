import { describe, expect, it } from 'bun:test';

import {
  resolvePermissionsPolicy,
  serializePermissionsPolicy,
  serializePermissionsPolicyReportOnly,
  validatePermissionsPolicy,
} from './serialize';

describe('permissions-policy', () => {
  it('defaults: standardized features denied, sync-xhr=(self), ch-ua-* excluded', () => {
    const r = resolvePermissionsPolicy(true);
    if (r === false) throw new Error('expected');
    expect(r.features.get('camera')).toEqual([]);
    expect(r.features.get('geolocation')).toEqual([]);
    expect(r.features.get('sync-xhr')).toEqual(['self']);
    expect(r.features.has('publickey-credentials-get')).toBe(true);
    // ch-ua-* are in the W3C registry but excluded from default-deny
    // (Client Hints have a separate opt-in lifecycle).
    expect(r.features.has('ch-ua')).toBe(false);
    expect(r.features.has('ch-ua-platform')).toBe(false);
    // publickey-credentials-create is not in the W3C registry.
    expect(r.features.has('publickey-credentials-create')).toBe(false);
  });

  it('does not warn on registry features that the package previously omitted', () => {
    // Regression: ch-ua-* and the newer Standardized features used to emit
    // an unknown-feature warning despite being in the W3C registry.
    const r = resolvePermissionsPolicy({
      features: {
        'ch-ua': [],
        'ch-ua-platform': [],
        'document-domain': [],
        'window-placement': [],
        'conversion-measurement': [],
      } as never,
    });
    if (r === false) throw new Error('expected');
    const warnings: never[] = [];
    validatePermissionsPolicy(r, 'pp', warnings as never);
    const unknownWarnings = (warnings as never[]).filter(
      (w: never) => (w as { reason: string }).reason === 'unknown_permissions_policy_feature',
    );
    expect(unknownWarnings).toEqual([]);
  });

  it('serialise empty allowlist as feature=()', () => {
    const r = resolvePermissionsPolicy({ features: { camera: [] } });
    if (r === false) throw new Error('expected');
    const entry = serializePermissionsPolicy(r);
    expect(entry?.[1]).toContain('camera=()');
  });

  it("serialise 'self' as bare token", () => {
    const r = resolvePermissionsPolicy({ features: { camera: ['self'] } });
    if (r === false) throw new Error('expected');
    expect(serializePermissionsPolicy(r)?.[1]).toContain('camera=(self)');
  });

  it('serialise wildcard *', () => {
    const r = resolvePermissionsPolicy({ features: { fullscreen: ['*'] } });
    if (r === false) throw new Error('expected');
    expect(serializePermissionsPolicy(r)?.[1]).toContain('fullscreen=*');
  });

  it('serialise origin via sf-string with double quotes', () => {
    const r = resolvePermissionsPolicy({
      features: { camera: ['self', 'https://x.example/'] },
    });
    if (r === false) throw new Error('expected');
    expect(serializePermissionsPolicy(r)?.[1]).toContain('camera=(self "https://x.example")');
  });

  it('accepts http:// origins (PLAN allows http + https for Permissions-Policy)', () => {
    const r = resolvePermissionsPolicy({ features: { camera: ['http://x.example/'] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_origin')).toBe(false);
  });

  it('rejects unsupported schemes (e.g., javascript:)', () => {
    const r = resolvePermissionsPolicy({ features: { camera: ['javascript:alert(1)'] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_origin')).toBe(true);
  });

  it('warns on unknown feature name', () => {
    const r = resolvePermissionsPolicy({ features: { 'made-up-thing': [] } });
    if (r === false) throw new Error('expected');
    const warnings: never[] = [];
    validatePermissionsPolicy(r, 'pp', warnings as never);
    expect((warnings as never[]).some((w: never) => (w as { reason: string }).reason === 'unknown_permissions_policy_feature')).toBe(true);
  });

  it('rejects __proto__ key (prototype pollution guard)', () => {
    const r = resolvePermissionsPolicy({ features: { __proto__: [] } as never });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'reserved_key_denied')).toBe(true);
  });

  it('returns false when input is false', () => {
    expect(resolvePermissionsPolicy(false)).toBe(false);
  });

  it('serialise returns undefined when feature map is empty (cannot happen via API)', () => {
    expect(serializePermissionsPolicy({ features: new Map() })).toBeUndefined();
  });

  it('reports too many features', () => {
    const big: Record<string, never[]> = {};
    for (let i = 0; i < 200; i++) big[`feat-${i}`] = [];
    const r = resolvePermissionsPolicy({ features: big as never });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('reports too long allowlist', () => {
    const big = Array.from({ length: 100 }, (_, i) => `https://${i}.example`);
    const r = resolvePermissionsPolicy({ features: { camera: big } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'input_too_large')).toBe(true);
  });

  it('rejects invalid feature-name grammar', () => {
    const r = resolvePermissionsPolicy({ features: { 'BAD NAME': [] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_token')).toBe(true);
  });

  it('rejects null-origin URL (e.g., file:)', () => {
    const r = resolvePermissionsPolicy({ features: { camera: ['file:///x'] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_origin')).toBe(true);
  });

  it('rejects non-string allowlist entry', () => {
    const r = resolvePermissionsPolicy({ features: { camera: [42 as never] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_origin')).toBe(true);
  });

  it('rejects unparseable origin (URL constructor throws)', () => {
    const r = resolvePermissionsPolicy({ features: { camera: ['::not a url'] } });
    if (r === false) throw new Error('expected');
    const out = validatePermissionsPolicy(r, 'pp', []);
    expect(out.some(v => v.reason === 'invalid_permissions_policy_origin')).toBe(true);
  });

  it('serializePermissionsPolicyReportOnly mirrors enforcing header', () => {
    const r = resolvePermissionsPolicy({ features: { camera: [] } });
    if (r === false) throw new Error('expected');
    expect(serializePermissionsPolicyReportOnly(r)?.[0]).toBe(
      'permissions-policy-report-only',
    );
  });

  it('serializePermissionsPolicyReportOnly returns undefined for empty feature map', () => {
    expect(serializePermissionsPolicyReportOnly({ features: new Map() })).toBeUndefined();
  });
});
