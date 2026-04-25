import { describe, expect, it } from 'bun:test';

import {
  resolvePermissionsPolicy,
  serializePermissionsPolicy,
  validatePermissionsPolicy,
} from './serialize';

describe('permissions-policy', () => {
  it('default Tier A+B all denied + sync-xhr=(self)', () => {
    const r = resolvePermissionsPolicy(true);
    if (r === false) throw new Error('expected');
    expect(r.features.get('camera')).toEqual([]);
    expect(r.features.get('geolocation')).toEqual([]);
    expect(r.features.get('sync-xhr')).toEqual(['self']);
    expect(r.features.has('publickey-credentials-get')).toBe(true); // Tier A
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
});
