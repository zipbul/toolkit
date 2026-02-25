import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { removeLeadingSlash } from './remove-leading-slash';

describe('removeLeadingSlash', () => {
  it('should remove leading slash from path', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/users/profile';
    removeLeadingSlash(ctx);

    expect(ctx.path).toBe('users/profile');
  });

  it('should not modify path that does not start with slash', () => {
    const ctx = new ProcessorContext({});
    ctx.path = 'users/profile';
    removeLeadingSlash(ctx);

    expect(ctx.path).toBe('users/profile');
  });

  it('should result in empty string when path is exactly a single slash', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/';
    removeLeadingSlash(ctx);

    expect(ctx.path).toBe('');
  });
});
