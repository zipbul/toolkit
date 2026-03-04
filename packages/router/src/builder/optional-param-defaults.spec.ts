import { describe, it, expect } from 'bun:test';

import { OptionalParamDefaults } from './optional-param-defaults';

describe('OptionalParamDefaults', () => {
  it('should not apply any defaults when behavior is omit', () => {
    const defaults = new OptionalParamDefaults('omit');
    defaults.record(0, ['lang']);

    const params: Record<string, string | undefined> = {};
    defaults.apply(0, params);

    expect(params).toEqual({});
  });

  it('should set missing params to undefined when behavior is setUndefined', () => {
    const defaults = new OptionalParamDefaults('setUndefined');
    defaults.record(0, ['lang', 'version']);

    const params: Record<string, string | undefined> = {};
    defaults.apply(0, params);

    expect(params).toEqual({ lang: undefined, version: undefined });
  });

  it('should set missing params to empty string when behavior is setEmptyString', () => {
    const defaults = new OptionalParamDefaults('setEmptyString');
    defaults.record(0, ['lang']);

    const params: Record<string, string | undefined> = {};
    defaults.apply(0, params);

    expect(params).toEqual({ lang: '' });
  });

  it('should not override param value that already exists', () => {
    const defaults = new OptionalParamDefaults('setUndefined');
    defaults.record(0, ['lang']);

    const params: Record<string, string | undefined> = { lang: 'en' };
    defaults.apply(0, params);

    expect(params.lang).toBe('en');
  });

  it('should do nothing when apply is called for a key that was never recorded', () => {
    const defaults = new OptionalParamDefaults('setUndefined');
    const params: Record<string, string | undefined> = {};
    defaults.apply(99, params);

    expect(params).toEqual({});
  });

  it('should use default behavior setUndefined when no behavior arg given', () => {
    const defaults = new OptionalParamDefaults();
    defaults.record(5, ['x']);

    const params: Record<string, string | undefined> = {};
    defaults.apply(5, params);

    expect(params.x).toBeUndefined();
  });
});
