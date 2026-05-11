import { describe, expect, it } from 'bun:test';

import {
  resolveIntegrityPolicy,
  serializeIntegrityPolicy,
  serializeIntegrityPolicyReportOnly,
  validateIntegrityPolicy,
} from './serialize';

describe('integrity-policy', () => {
  it('default emits blocked-destinations + sources=(inline)', () => {
    const r = resolveIntegrityPolicy(true);
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeIntegrityPolicy(r)).toEqual([
      'integrity-policy',
      'blocked-destinations=(script style), sources=(inline)',
    ]);
  });

  it('Report-Only mirrors enforce body', () => {
    const r = resolveIntegrityPolicy(true);
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeIntegrityPolicyReportOnly(r)[0]).toBe('integrity-policy-report-only');
  });

  it('false disables', () => {
    expect(resolveIntegrityPolicy(false)).toBe(false);
  });

  it('explicit endpoints serialise as Inner List', () => {
    const r = resolveIntegrityPolicy({ endpoints: ['default', 'csp-endpoint'] });
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeIntegrityPolicy(r)[1]).toBe(
      'blocked-destinations=(script style), sources=(inline), endpoints=(default csp-endpoint)',
    );
  });

  it('rejects invalid destination', () => {
    const r = resolveIntegrityPolicy({ blockedDestinations: ['image' as never] });
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateIntegrityPolicy(r, 'integrityPolicy', new Set());
    expect(out.some(v => v.reason === 'invalid_integrity_destination')).toBe(true);
  });

  it('rejects empty blocked-destinations', () => {
    const r = resolveIntegrityPolicy({ blockedDestinations: [] });
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateIntegrityPolicy(r, 'integrityPolicy', new Set());
    expect(out.some(v => v.reason === 'integrity_policy_empty')).toBe(true);
  });

  it('rejects unknown endpoint name', () => {
    const r = resolveIntegrityPolicy({ endpoints: ['ghost'] });
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateIntegrityPolicy(r, 'integrityPolicy', new Set(['known']));
    expect(out.some(v => v.reason === 'unknown_reporting_endpoint')).toBe(true);
  });

  it('rejects non-inline source token', () => {
    const r = resolveIntegrityPolicy({ sources: ['external' as never] });
    if (r === false || r === undefined) throw new Error('expected');
    const out = validateIntegrityPolicy(r, 'integrityPolicy', new Set());
    expect(out.some(v => v.reason === 'invalid_integrity_source')).toBe(true);
  });
});
