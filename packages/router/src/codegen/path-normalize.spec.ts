import { describe, expect, it } from 'bun:test';

import { buildPathNormalizer, emitLowerCase, emitTrailingSlashTrim } from './path-normalize';

describe('emitTrailingSlashTrim', () => {
  it('returns empty string when trimSlash is off', () => {
    expect(emitTrailingSlashTrim({ trimSlash: false, lowerCase: false }, 'sp')).toBe('');
  });

  it('emits a length-guarded trailing-slash trim against the supplied var', () => {
    const out = emitTrailingSlashTrim({ trimSlash: true, lowerCase: false }, 'sp');
    expect(out).toContain('sp.length > 1');
    expect(out).toContain('charCodeAt(sp.length - 1) === 47');
    expect(out).toContain('sp.substring(0, sp.length - 1)');
  });
});

describe('emitLowerCase', () => {
  it('returns empty string when lowerCase is off', () => {
    expect(emitLowerCase({ trimSlash: false, lowerCase: false }, 'sp')).toBe('');
  });

  it('emits an in-place toLowerCase assignment against the supplied var', () => {
    expect(emitLowerCase({ trimSlash: false, lowerCase: true }, 'sp')).toContain('sp = sp.toLowerCase();');
  });
});

describe('buildPathNormalizer', () => {
  it('passes the path through unchanged when both flags are off', () => {
    const norm = buildPathNormalizer({ trimSlash: false, lowerCase: false });
    expect(norm('/Health/')).toBe('/Health/');
  });

  it('trims a single trailing slash when trimSlash is on', () => {
    const norm = buildPathNormalizer({ trimSlash: true, lowerCase: false });
    expect(norm('/health/')).toBe('/health');
    expect(norm('/health')).toBe('/health');
  });

  it('keeps the root slash even with trimSlash on (length > 1 guard)', () => {
    const norm = buildPathNormalizer({ trimSlash: true, lowerCase: false });
    expect(norm('/')).toBe('/');
  });

  it('lowercases the path when lowerCase is on', () => {
    const norm = buildPathNormalizer({ trimSlash: false, lowerCase: true });
    expect(norm('/Health')).toBe('/health');
    expect(norm('/HEALTH/USERS')).toBe('/health/users');
  });

  it('applies trim and lowerCase together (trim happens before lower)', () => {
    const norm = buildPathNormalizer({ trimSlash: true, lowerCase: true });
    expect(norm('/Health/')).toBe('/health');
  });
});
