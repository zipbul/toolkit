import { describe, expect, it } from 'bun:test';

import { serializeXRobotsTag } from './serialize';
import { validateXRobotsTag } from './validate';

describe('x-robots-tag/serialize', () => {
  it('joins directives with comma-space', () => {
    expect(serializeXRobotsTag(['noindex', 'nofollow'])).toEqual([
      'x-robots-tag',
      'noindex, nofollow',
    ]);
  });

  it('handles single directive', () => {
    expect(serializeXRobotsTag(['none'])).toEqual(['x-robots-tag', 'none']);
  });

  it('handles empty list', () => {
    expect(serializeXRobotsTag([])).toEqual(['x-robots-tag', '']);
  });
});

describe('x-robots-tag/validate', () => {
  // Per https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
  it('accepts all boolean rules', () => {
    for (const rule of [
      'noindex',
      'nofollow',
      'none',
      'all',
      'nosnippet',
      'indexifembedded',
      'notranslate',
      'noimageindex',
    ]) {
      expect(validateXRobotsTag([rule], 'xrt')).toEqual([]);
    }
  });

  it('accepts max-snippet with integer (incl. 0 and -1)', () => {
    for (const v of ['max-snippet: 0', 'max-snippet: -1', 'max-snippet: 100']) {
      expect(validateXRobotsTag([v], 'xrt')).toEqual([]);
    }
  });

  it('rejects max-snippet with non-integer', () => {
    expect(validateXRobotsTag(['max-snippet: ten'], 'xrt')).toHaveLength(1);
    expect(validateXRobotsTag(['max-snippet: '], 'xrt')).toHaveLength(1);
  });

  it('accepts max-image-preview with valid value', () => {
    for (const v of ['max-image-preview: none', 'max-image-preview: standard', 'max-image-preview: large']) {
      expect(validateXRobotsTag([v], 'xrt')).toEqual([]);
    }
    expect(validateXRobotsTag(['max-image-preview: huge'], 'xrt')).toHaveLength(1);
  });

  it('accepts max-video-preview with integer', () => {
    expect(validateXRobotsTag(['max-video-preview: 30'], 'xrt')).toEqual([]);
    expect(validateXRobotsTag(['max-video-preview: -1'], 'xrt')).toEqual([]);
    expect(validateXRobotsTag(['max-video-preview: x'], 'xrt')).toHaveLength(1);
  });

  it('accepts unavailable_after with date string', () => {
    expect(
      validateXRobotsTag(['unavailable_after: 2025-12-31T23:59:59Z'], 'xrt'),
    ).toEqual([]);
    expect(
      validateXRobotsTag(['unavailable_after: 31 Dec 2025 23:59:59 GMT'], 'xrt'),
    ).toEqual([]);
    expect(validateXRobotsTag(['unavailable_after: '], 'xrt')).toHaveLength(1);
  });

  it('accepts bot-name prefix per Google spec', () => {
    expect(validateXRobotsTag(['googlebot: noindex'], 'xrt')).toEqual([]);
    expect(validateXRobotsTag(['AdsBot-Google: nofollow'], 'xrt')).toEqual([]);
    expect(validateXRobotsTag(['googlebot: max-snippet: 10'], 'xrt')).toEqual([]);
  });

  it('rejects unknown rules', () => {
    expect(validateXRobotsTag(['mango'], 'xrt')).toHaveLength(1);
    expect(validateXRobotsTag(['noai'], 'xrt')).toHaveLength(1); // not in Google spec
  });

  it('rejects unknown rule with value form (e.g., "unknown-rule: 5")', () => {
    expect(validateXRobotsTag(['unknown-rule: 5'], 'xrt')).toHaveLength(1);
  });

  it('rejects unknown name:value pair after bot prefix (default switch arm)', () => {
    // 'googlebot:' is parsed as bot prefix; 'weirdrule: 5' then falls through
    // the value-rule switch because 'weirdrule' is none of the four valid names.
    expect(validateXRobotsTag(['googlebot: weirdrule: 5'], 'xrt')).toHaveLength(1);
  });

  it('rejects entries containing comma (would corrupt header)', () => {
    expect(validateXRobotsTag(['noindex, nofollow'], 'xrt')).toHaveLength(1);
  });

  it('rejects CR/LF (header injection guard)', () => {
    expect(validateXRobotsTag(['noindex\r\nX-Bad: yes'], 'xrt')).toHaveLength(1);
  });

  it('rejects empty entries', () => {
    expect(validateXRobotsTag([''], 'xrt')).toHaveLength(1);
    expect(validateXRobotsTag(['   '], 'xrt')).toHaveLength(1);
  });

  it('rejects non-string entries', () => {
    expect(validateXRobotsTag([123 as never], 'xrt')).toHaveLength(1);
  });
});
