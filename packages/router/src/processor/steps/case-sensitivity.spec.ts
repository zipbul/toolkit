import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { toLowerCase } from './case-sensitivity';

describe('toLowerCase', () => {
  it('should convert uppercase segments to lowercase', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['Users', 'PROFILE'];
    toLowerCase(ctx);

    expect(ctx.segments).toEqual(['users', 'profile']);
  });

  it('should not modify already lowercase segments', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['users', 'profile'];
    toLowerCase(ctx);

    expect(ctx.segments).toEqual(['users', 'profile']);
  });

  it('should skip empty string segment unchanged', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = [''];
    toLowerCase(ctx);

    expect(ctx.segments).toEqual(['']);
  });

  it('should convert only uppercase segments in a mixed-case array', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['Users', 'api', 'V2'];
    toLowerCase(ctx);

    expect(ctx.segments).toEqual(['users', 'api', 'v2']);
  });
});
