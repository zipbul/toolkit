import { describe, it, expect } from 'bun:test';

import type { PathPart } from '../tree';

import { PathPartType } from '../tree';
import { OptionalParamDefaults } from './optional-param-defaults';
import { expandOptional, MAX_OPTIONAL_SEGMENTS_PER_ROUTE } from './route-expand';

const param = (name: string, optional = false): PathPart => ({
  type: PathPartType.Param,
  name,
  pattern: null,
  optional,
});

const staticPart = (value: string): PathPart => {
  const body = value.length > 1 ? value.slice(1) : '';
  const segments = body === '' ? [] : body.split('/');
  return { type: PathPartType.Static, value, segments };
};

describe('expandOptional — no optionals', () => {
  it('should pass parts through unchanged', () => {
    const parts: PathPart[] = [staticPart('/users/'), param('id')];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 7, defaults);

    expect(result).toEqual([{ parts, handlerIndex: 7, isOptionalExpansion: false }]);
    expect(defaults.snapshot().entries.find(([k]) => k === 7)).toBeUndefined();
  });
});

describe('expandOptional — 2^N expansion', () => {
  it('should produce 2^N variants for N optionals', () => {
    const parts: PathPart[] = [staticPart('/'), param('a', true), staticPart('/'), param('b', true)];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    expect(result.length).toBe(4);
  });

  it('should keep the mid-position N=1 i18n shape to exactly 2 variants', () => {
    const parts: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/posts')];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    expect(result.length).toBe(2);
    expect(result[0]!.parts).toEqual([staticPart('/'), param('lang'), staticPart('/posts')]);
    expect(result[1]!.parts).toEqual([staticPart('/posts')]);
  });

  it('should honor MAX_OPTIONAL_SEGMENTS_PER_ROUTE at the boundary (exactly 2^N variants)', () => {
    const parts: PathPart[] = [
      staticPart('/'),
      ...Array.from({ length: MAX_OPTIONAL_SEGMENTS_PER_ROUTE }, (_, i) => param(`p${i}`, true)),
    ];
    const defaults = new OptionalParamDefaults(false);
    const result = expandOptional(parts, 0, defaults);
    expect(result.length).toBe(1 << MAX_OPTIONAL_SEGMENTS_PER_ROUTE);
  });

  it('should record omitted-param names against defaults for matcher fill-in', () => {
    const parts: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/'), param('region', true)];
    const defaults = new OptionalParamDefaults(false);

    expandOptional(parts, 42, defaults);

    expect(defaults.snapshot().entries.find(([k]) => k === 42)).toBeDefined();
  });

  it('should mark optionals as required (optional=false) inside each variant for insertion', () => {
    const parts: PathPart[] = [staticPart('/'), param('id', true)];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    const fullVariant = result[0]!;
    const idPart = fullVariant.parts.find(
      (p: PathPart): p is Extract<PathPart, { type: PathPartType.Param }> => p.type === PathPartType.Param && p.name === 'id',
    );
    expect(idPart).toBeDefined();
    expect((idPart as { optional: boolean }).optional).toBe(false);
  });
});

describe('expandOptional — drop-time slash trim', () => {
  it('should trim trailing slash of preceding static when optional is dropped', () => {
    const parts: PathPart[] = [staticPart('/users/'), param('id', true)];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    const dropped = result[1]!.parts;
    expect(dropped).toEqual([{ type: PathPartType.Static, value: '/users', segments: ['users'] }]);
  });

  it('should pop the static entirely when trim leaves an empty value', () => {
    const parts: PathPart[] = [staticPart('/'), param('id', true)];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    expect(result[1]!.parts).toEqual([{ type: PathPartType.Static, value: '/', segments: [] }]);
  });
});

describe('expandOptional — post-merge `//` collapse', () => {
  it('should collapse `//` produced by joining two static parts', () => {
    const parts: PathPart[] = [staticPart('/a/'), param('x', true), staticPart('/b')];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    const dropped = result[1]!.parts;
    expect(dropped).toEqual([{ type: PathPartType.Static, value: '/a/b', segments: ['a', 'b'] }]);
  });

  it('should preserve a non-trailing-slash static when an adjacent optional is dropped', () => {
    const parts: PathPart[] = [staticPart('/users'), param('id', true)];
    const defaults = new OptionalParamDefaults(false);

    const result = expandOptional(parts, 0, defaults);

    expect(result[1]!.parts).toEqual([staticPart('/users')]);
  });
});
