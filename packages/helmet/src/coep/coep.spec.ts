import { describe, expect, it } from 'bun:test';

import { isValidCoep, serializeCoep, serializeCoepReportOnly } from './serialize';

describe('coep', () => {
  it('serializes require-corp / credentialless / unsafe-none', () => {
    expect(serializeCoep({ value: 'require-corp' })).toEqual([
      'cross-origin-embedder-policy',
      'require-corp',
    ]);
    expect(serializeCoep({ value: 'credentialless' })).toEqual([
      'cross-origin-embedder-policy',
      'credentialless',
    ]);
  });

  it('serializes Report-Only variant', () => {
    expect(serializeCoepReportOnly({ value: 'credentialless' })).toEqual([
      'cross-origin-embedder-policy-report-only',
      'credentialless',
    ]);
  });

  it('attaches report-to parameter (HTML §7.1.4.1)', () => {
    expect(serializeCoep({ value: 'require-corp', reportTo: 'coep-ep' })).toEqual([
      'cross-origin-embedder-policy',
      'require-corp; report-to="coep-ep"',
    ]);
  });

  it('isValidCoep type guard', () => {
    expect(isValidCoep('require-corp')).toBe(true);
    expect(isValidCoep('bogus')).toBe(false);
  });
});
