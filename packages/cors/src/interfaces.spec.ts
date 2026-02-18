import { describe, expect, it } from 'bun:test';

import type { CorsOptions, CorsResult } from './interfaces';

describe('interfaces', () => {
  it('should allow typed cors options object when options shape is valid', () => {
    const options: CorsOptions = {
      origin: true,
      credentials: true,
      maxAge: 0,
      preflightContinue: false,
    };

    expect(options.origin).toBe(true);
    expect(options.maxAge).toBe(0);
  });

  it('should allow typed cors result object when result shape is valid', () => {
    const result: CorsResult = {
      headers: new Headers(),
      isPreflight: false,
      isAllowed: true,
      shouldRespond: false,
      statusCode: null,
    };

    expect(result.shouldRespond).toBe(false);
    expect(result.statusCode).toBeNull();
  });
});
