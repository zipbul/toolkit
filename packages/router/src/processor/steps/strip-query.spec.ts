import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { stripQuery } from './strip-query';

describe('stripQuery', () => {
  it('should remove query string starting at question mark', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/users?page=1&limit=10';
    stripQuery(ctx);

    expect(ctx.path).toBe('/users');
  });

  it('should leave path unchanged when there is no question mark', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/users/profile';
    stripQuery(ctx);

    expect(ctx.path).toBe('/users/profile');
  });

  it('should strip everything including the question mark at position 0', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '?standalone-query';
    stripQuery(ctx);

    expect(ctx.path).toBe('');
  });

  it('should strip only to the first question mark when multiple exist', () => {
    const ctx = new ProcessorContext({});
    ctx.path = '/path?a=1?b=2';
    stripQuery(ctx);

    expect(ctx.path).toBe('/path');
  });
});
