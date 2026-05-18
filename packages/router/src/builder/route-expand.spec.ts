import { describe, it, expect } from 'bun:test';

import type { PathPart } from '../tree';

import { OptionalParamDefaults } from './optional-param-defaults';
import {
  countOptionalSegments,
  expandOptional,
  filterDroppedSegments,
  isDroppedAt,
  MAX_OPTIONAL_SEGMENTS_PER_ROUTE,
  trimTrailingSlashOnDrop,
} from './route-expand';

const param = (name: string, optional = false): PathPart => ({
  type: 'param',
  name,
  pattern: null,
  optional,
});

const staticPart = (value: string): PathPart => {
  const body = value.length > 1 ? value.slice(1) : '';
  const segments = body === '' ? [] : body.split('/');
  return { type: 'static', value, segments };
};

describe('expandOptional', () => {
  describe('collectOptionalIndices (path with no optionals)', () => {
    it('should pass parts through unchanged', () => {
      const parts: PathPart[] = [staticPart('/users/'), param('id')];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 7, defaults);

      expect(result).toEqual([{ parts, handlerIndex: 7, isOptionalExpansion: false }]);
      expect(defaults.snapshot().entries.find(([k]) => k === 7)).toBeUndefined();
    });
  });

  describe('enumerateExpansions', () => {
    it('should produce 2^N variants for N optionals', () => {
      const parts: PathPart[] = [staticPart('/'), param('a', true), staticPart('/'), param('b', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(result.length).toBe(4);
    });

    it('should keep the mid-position N=1 i18n shape to exactly 2 variants', () => {
      const parts: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/posts')];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(countOptionalSegments(parts)).toBe(1);
      expect(result.length).toBe(2);
      expect(result[0]!.parts).toEqual([staticPart('/'), param('lang'), staticPart('/posts')]);
      expect(result[1]!.parts).toEqual([staticPart('/posts')]);
    });

    it('should count optional segments by N, not by position', () => {
      const mid: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/posts')];
      const last: PathPart[] = [staticPart('/posts/'), param('id', true)];
      const overCap: PathPart[] = [
        staticPart('/'),
        ...Array.from({ length: MAX_OPTIONAL_SEGMENTS_PER_ROUTE + 1 }, (_, i) => param(`p${i}`, true)),
      ];

      expect(countOptionalSegments(mid)).toBe(1);
      expect(countOptionalSegments(last)).toBe(1);
      expect(countOptionalSegments(overCap)).toBe(MAX_OPTIONAL_SEGMENTS_PER_ROUTE + 1);
    });

    it('should record omitted-param names against defaults for matcher fill-in', () => {
      const parts: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/'), param('region', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      expandOptional(parts, 42, defaults);

      expect(defaults.snapshot().entries.find(([k]) => k === 42)).toBeDefined();
    });

    it('should mark optionals as required (optional=false) inside each variant for insertion', () => {
      const parts: PathPart[] = [staticPart('/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      const fullVariant = result[0]!;
      const idPart = fullVariant.parts.find((p: PathPart) => p.type === 'param' && p.name === 'id');
      expect(idPart).toBeDefined();
      expect((idPart as { optional: boolean }).optional).toBe(false);
    });
  });

  describe('Invariant A — drop-time slash trim', () => {
    it('should trim trailing slash of preceding static when optional is dropped', () => {
      // `/users/:id?` with `:id` dropped should yield `/users`, not `/users/`.
      const parts: PathPart[] = [staticPart('/users/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      // Variant 0: full path. Variant 1: dropped optional.
      const dropped = result[1]!.parts;
      expect(dropped).toEqual([{ type: 'static', value: '/users', segments: ['users'] }]);
    });

    it('should pop the static entirely when trim leaves an empty value', () => {
      // `/:id?` with `:id` dropped — preceding static is `/` which trims to ''.
      const parts: PathPart[] = [staticPart('/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      // Falls back to the empty-result `/` recovery path.
      expect(result[1]!.parts).toEqual([{ type: 'static', value: '/', segments: [] }]);
    });
  });

  describe('Invariant B — post-merge `//` collapse', () => {
    it('should collapse `//` produced by joining two static parts', () => {
      // `/a/:x?/b` with `:x` dropped: parts become `/a/` + `/b` → `/a//b` → `/a/b`.
      const parts: PathPart[] = [staticPart('/a/'), param('x', true), staticPart('/b')];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      const dropped = result[1]!.parts;
      expect(dropped).toEqual([{ type: 'static', value: '/a/b', segments: ['a', 'b'] }]);
    });
  });
});

describe('isDroppedAt', () => {
  it('returns true when partIndex is in optionalIndices and the matching bit is set', () => {
    expect(isDroppedAt(2, [1, 2, 4], 0b010)).toBe(true);
  });

  it('returns false when partIndex matches but the bit is unset', () => {
    expect(isDroppedAt(2, [1, 2, 4], 0b001)).toBe(false);
  });

  it('returns false when partIndex is not in optionalIndices', () => {
    expect(isDroppedAt(3, [1, 2, 4], 0b111)).toBe(false);
  });

  it('returns false for an empty optionalIndices list', () => {
    expect(isDroppedAt(0, [], 0xff)).toBe(false);
  });
});

describe('trimTrailingSlashOnDrop', () => {
  it('is a no-op on an empty list', () => {
    const xs: PathPart[] = [];
    trimTrailingSlashOnDrop(xs);
    expect(xs).toEqual([]);
  });

  it('peels a single trailing slash from the last static segment', () => {
    const xs: PathPart[] = [{ type: 'static', value: '/users/', segments: ['users', ''] }];
    trimTrailingSlashOnDrop(xs);
    expect(xs[0]).toMatchObject({ type: 'static', value: '/users' });
  });

  it('removes the segment entirely when trimming would leave only the leading slash', () => {
    const xs: PathPart[] = [{ type: 'static', value: '/', segments: [''] }];
    trimTrailingSlashOnDrop(xs);
    expect(xs).toEqual([]);
  });

  it('leaves non-trailing-slash statics alone', () => {
    const xs: PathPart[] = [{ type: 'static', value: '/users', segments: ['users'] }];
    trimTrailingSlashOnDrop(xs);
    expect(xs[0]).toMatchObject({ type: 'static', value: '/users' });
  });

  it('does not touch a non-static last entry', () => {
    const xs: PathPart[] = [{ type: 'param', name: 'id', pattern: null, optional: false }];
    trimTrailingSlashOnDrop(xs);
    expect(xs[0]).toMatchObject({ type: 'param', name: 'id' });
  });
});

describe('filterDroppedSegments', () => {
  it('returns the input shape with optional flags flipped to required when no drops', () => {
    const parts: PathPart[] = [
      { type: 'static', value: '/users', segments: ['users'] },
      { type: 'param', name: 'id', pattern: null, optional: true },
    ];
    const filtered = filterDroppedSegments(parts, [1], 0);
    expect(filtered).toHaveLength(2);
    expect(filtered[1]).toMatchObject({ type: 'param', name: 'id', optional: false });
  });

  it('drops the indicated optional and trims trailing slash on the prior static', () => {
    const parts: PathPart[] = [
      { type: 'static', value: '/users/', segments: ['users', ''] },
      { type: 'param', name: 'id', pattern: null, optional: true },
    ];
    const filtered = filterDroppedSegments(parts, [1], 0b1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ type: 'static', value: '/users' });
  });
});
