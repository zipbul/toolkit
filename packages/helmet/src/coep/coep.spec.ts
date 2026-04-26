import { describe, expect, it } from 'bun:test';

import { isValidCoep, serializeCoep, serializeCoepReportOnly } from './serialize';

describe('coep', () => {
  it('serializes require-corp / credentialless / unsafe-none', () => {
    expect(serializeCoep('require-corp')).toEqual(['cross-origin-embedder-policy', 'require-corp']);
    expect(serializeCoep('credentialless')).toEqual([
      'cross-origin-embedder-policy',
      'credentialless',
    ]);
  });

  it('serializes Report-Only variant', () => {
    expect(serializeCoepReportOnly('credentialless')).toEqual([
      'cross-origin-embedder-policy-report-only',
      'credentialless',
    ]);
  });

  it('isValidCoep type guard', () => {
    expect(isValidCoep('require-corp')).toBe(true);
    expect(isValidCoep('bogus')).toBe(false);
  });
});
