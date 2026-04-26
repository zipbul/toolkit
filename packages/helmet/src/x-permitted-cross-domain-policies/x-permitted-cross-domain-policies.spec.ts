import { describe, expect, it } from 'bun:test';

import { serializeXPermittedCrossDomainPolicies } from './serialize';
import { validateXPermittedCrossDomainPolicies } from './validate';

describe('x-permitted-cross-domain-policies/serialize', () => {
  for (const v of ['none', 'master-only', 'by-content-type', 'by-ftp-filename', 'all'] as const) {
    it(`emits ${v}`, () => {
      expect(serializeXPermittedCrossDomainPolicies(v)).toEqual([
        'x-permitted-cross-domain-policies',
        v,
      ]);
    });
  }
});

describe('x-permitted-cross-domain-policies/validate', () => {
  it('accepts all five OWASP-documented values', () => {
    for (const v of ['none', 'master-only', 'by-content-type', 'by-ftp-filename', 'all']) {
      expect(validateXPermittedCrossDomainPolicies(v, 'xpcdp')).toEqual([]);
    }
  });
  it('rejects unknown', () => {
    expect(validateXPermittedCrossDomainPolicies('public', 'xpcdp')).toHaveLength(1);
    expect(validateXPermittedCrossDomainPolicies('', 'xpcdp')).toHaveLength(1);
    expect(validateXPermittedCrossDomainPolicies('NONE', 'xpcdp')).toHaveLength(1);
  });
});
