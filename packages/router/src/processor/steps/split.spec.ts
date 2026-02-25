import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { splitPath } from './split';

describe('splitPath', () => {
  it('should produce empty segments for empty string path', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '';
    splitPath(ctx);

    expect(ctx.segments).toEqual([]);
  });

  it('should split a normal path into segments', () => {
    const ctx = new ProcessorContext({});
    ctx.path = 'users/profile';
    splitPath(ctx);

    expect(ctx.segments).toEqual(['users', 'profile']);
  });

  it('should preserve empty segment from leading slash in raw path', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/users/profile';
    splitPath(ctx);

    expect(ctx.segments).toEqual(['', 'users', 'profile']);
  });

  it('should produce trailing empty segment for path ending with slash', () => {
    const ctx = new ProcessorContext({});
    ctx.path = 'users/';
    splitPath(ctx);

    expect(ctx.segments).toEqual(['users', '']);
  });
});
