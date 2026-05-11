import { describe, expect, it } from 'bun:test';

import {
  resolveClearSiteData,
  serializeClearSiteData,
  validateClearSiteData,
} from './serialize';

describe('clear-site-data', () => {
  it('default tokens for boolean true', () => {
    const r = resolveClearSiteData(true);
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeClearSiteData(r)).toEqual(['clear-site-data', '"cache", "cookies", "storage"']);
  });

  it('warns on Chromium-only token', () => {
    const r = resolveClearSiteData({ directives: ['cache', 'prefetchCache'] });
    if (r === false || r === undefined) throw new Error('expected');
    const warnings: never[] = [];
    const errs = validateClearSiteData(r, 'csd', warnings as never);
    expect(errs).toEqual([]);
    expect((warnings as never[]).some((w: never) => (w as { reason: string }).reason === 'non_standard_clear_site_data_token')).toBe(true);
  });

  it('rejects unknown token', () => {
    const r = resolveClearSiteData({ directives: ['weird-thing' as never] });
    if (r === false || r === undefined) throw new Error('expected');
    const errs = validateClearSiteData(r, 'csd', []);
    expect(errs.some(v => v.reason === 'invalid_clear_site_data_directive')).toBe(true);
  });

  it('false disables', () => {
    expect(resolveClearSiteData(false)).toBe(false);
  });
});
