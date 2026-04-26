import { describe, expect, it } from 'bun:test';

import { serializeTimingAllowOrigin } from './serialize';
import { validateTimingAllowOrigin } from './validate';

describe('timing-allow-origin/serialize', () => {
  it('joins origins with comma-space', () => {
    expect(serializeTimingAllowOrigin(['https://a.example', 'https://b.example'])).toEqual([
      'timing-allow-origin',
      'https://a.example, https://b.example',
    ]);
  });
  it('emits wildcard verbatim', () => {
    expect(serializeTimingAllowOrigin(['*'])).toEqual(['timing-allow-origin', '*']);
  });
  it('emits null sentinel verbatim (Fetch spec origin-or-null)', () => {
    expect(serializeTimingAllowOrigin(['null'])).toEqual(['timing-allow-origin', 'null']);
  });
});

describe('timing-allow-origin/validate', () => {
  it('accepts wildcard, null, http(s) origins, and ports', () => {
    expect(validateTimingAllowOrigin(['*'], 'tao')).toEqual([]);
    expect(validateTimingAllowOrigin(['null'], 'tao')).toEqual([]);
    expect(validateTimingAllowOrigin(['https://x.example'], 'tao')).toEqual([]);
    expect(validateTimingAllowOrigin(['https://x.example:8443'], 'tao')).toEqual([]);
    expect(validateTimingAllowOrigin(['http://localhost:3000'], 'tao')).toEqual([]);
  });

  it('rejects path component (Resource Timing §3.5.2)', () => {
    expect(validateTimingAllowOrigin(['https://x.example/path'], 'tao')).toHaveLength(1);
  });

  it('rejects fragment component', () => {
    expect(validateTimingAllowOrigin(['https://x.example#frag'], 'tao')).toHaveLength(1);
  });

  it('rejects query component', () => {
    expect(validateTimingAllowOrigin(['https://x.example?q=1'], 'tao')).toHaveLength(1);
  });

  it('rejects whitespace inside value', () => {
    expect(validateTimingAllowOrigin(['https://x .example'], 'tao')).toHaveLength(1);
  });

  it('rejects unknown schemes', () => {
    expect(validateTimingAllowOrigin(['ftp://x.example'], 'tao')).toHaveLength(1);
  });

  it('rejects non-strings', () => {
    expect(validateTimingAllowOrigin([42 as never], 'tao')).toHaveLength(1);
  });
});
