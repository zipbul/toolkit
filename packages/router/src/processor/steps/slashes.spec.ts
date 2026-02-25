import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { collapseSlashes, handleTrailingSlashOptions } from './slashes';

describe('collapseSlashes', () => {
  it('should filter out empty segments leaving non-empty ones', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', '', '', 'b'];
    collapseSlashes(ctx);

    expect(ctx.segments).toEqual(['a', 'b']);
  });

  it('should preserve already clean non-empty segments unchanged', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', 'b', 'c'];
    collapseSlashes(ctx);

    expect(ctx.segments).toEqual(['a', 'b', 'c']);
  });

  it('should result in empty array when all segments are empty strings', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['', ''];
    collapseSlashes(ctx);

    expect(ctx.segments).toEqual([]);
  });
});

describe('handleTrailingSlashOptions', () => {
  it('should pop the trailing empty segment when ignoreTrailingSlash is true', () => {
    const ctx = new ProcessorContext({ ignoreTrailingSlash: true });
    ctx.segments = ['a', 'b', ''];
    handleTrailingSlashOptions(ctx);

    expect(ctx.segments).toEqual(['a', 'b']);
  });

  it('should not pop trailing segment when ignoreTrailingSlash is false', () => {
    const ctx = new ProcessorContext({ ignoreTrailingSlash: false });
    ctx.segments = ['a', 'b', ''];
    handleTrailingSlashOptions(ctx);

    expect(ctx.segments).toEqual(['a', 'b', '']);
  });

  it('should not modify segments when there is no trailing empty segment', () => {
    const ctx = new ProcessorContext({ ignoreTrailingSlash: true });
    ctx.segments = ['a', 'b'];
    handleTrailingSlashOptions(ctx);

    expect(ctx.segments).toEqual(['a', 'b']);
  });
});
