import { describe, expect, it } from 'bun:test';

import { serializeXDownloadOptions } from './serialize';

describe('x-download-options/serialize', () => {
  // Per IE/Edge legacy spec — only `noopen` is valid.
  it('emits the canonical noopen value', () => {
    expect(serializeXDownloadOptions()).toEqual(['x-download-options', 'noopen']);
  });
});
