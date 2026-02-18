import { describe, expect, it } from 'bun:test';

import { HttpMethod, HttpStatus } from '@zipbul/shared';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';

describe('constants', () => {
  it('should include default cors methods when constants are loaded', () => {
    const expected = [
      HttpMethod.Get,
      HttpMethod.Head,
      HttpMethod.Put,
      HttpMethod.Patch,
      HttpMethod.Post,
      HttpMethod.Delete,
    ];

    expect(CORS_DEFAULT_METHODS).toEqual(expected);
  });

  it('should include no-content as default options status when constants are loaded', () => {
    expect(CORS_DEFAULT_OPTIONS_SUCCESS_STATUS).toBe(HttpStatus.NoContent);
  });
});
