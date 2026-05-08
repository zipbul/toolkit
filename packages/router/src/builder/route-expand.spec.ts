import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import type { PathPart } from './path-parser';
import { OptionalParamDefaults } from './optional-param-defaults';
import { expandOptional } from './route-expand';

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

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ parts, handlerIndex: 7, isOptionalExpansion: false }]);
      expect(defaults.has(7)).toBe(false);
    });
  });

  describe('validateOptionalCount', () => {
    it('rejects an optional count whose 2^N expansion exceeds the cap', () => {
      const parts: PathPart[] = [];

      for (let i = 0; i < 11; i++) {
        parts.push(staticPart(`/p${i}/`));
        parts.push(param(`a${i}`, true));
      }

      const defaults = new OptionalParamDefaults('set-undefined');
      const result = expandOptional(parts, 0, defaults, 1024);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('optional-expansion-limit');
      }
    });

    it('accepts exactly the cap of 1024 expansions (2^10)', () => {
      const parts: PathPart[] = [];

      for (let i = 0; i < 10; i++) {
        parts.push(staticPart(`/p${i}/`));
        parts.push(param(`a${i}`, true));
      }

      const defaults = new OptionalParamDefaults('set-undefined');
      const result = expandOptional(parts, 0, defaults, 1024);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.length).toBe(1 << 10);
      }
    });
  });

  describe('enumerateExpansions', () => {
    it('should produce 2^N variants for N optionals', () => {
      const parts: PathPart[] = [staticPart('/'), param('a', true), staticPart('/'), param('b', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.length).toBe(4);
      }
    });

    it('should record omitted-param names against defaults for matcher fill-in', () => {
      const parts: PathPart[] = [staticPart('/'), param('lang', true), staticPart('/'), param('region', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      expandOptional(parts, 42, defaults);

      expect(defaults.has(42)).toBe(true);
    });

    it('should mark optionals as required (optional=false) inside each variant for insertion', () => {
      const parts: PathPart[] = [staticPart('/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const fullVariant = result[0]!;
        const idPart = fullVariant.parts.find(p => p.type === 'param' && p.name === 'id');
        expect(idPart).toBeDefined();
        expect((idPart as { optional: boolean }).optional).toBe(false);
      }
    });
  });

  describe('Invariant A — drop-time slash trim', () => {
    it('should trim trailing slash of preceding static when optional is dropped', () => {
      // `/users/:id?` with `:id` dropped should yield `/users`, not `/users/`.
      const parts: PathPart[] = [staticPart('/users/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        // Variant 0: full path. Variant 1: dropped optional.
        const dropped = result[1]!.parts;
        expect(dropped).toEqual([{ type: 'static', value: '/users', segments: ['users'] }]);
      }
    });

    it('should pop the static entirely when trim leaves an empty value', () => {
      // `/:id?` with `:id` dropped — preceding static is `/` which trims to ''.
      const parts: PathPart[] = [staticPart('/'), param('id', true)];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        // Falls back to the empty-result `/` recovery path.
        expect(result[1]!.parts).toEqual([{ type: 'static', value: '/', segments: [] }]);
      }
    });
  });

  describe('Invariant B — post-merge `//` collapse', () => {
    it('should collapse `//` produced by joining two static parts', () => {
      // `/a/:x?/b` with `:x` dropped: parts become `/a/` + `/b` → `/a//b` → `/a/b`.
      const parts: PathPart[] = [staticPart('/a/'), param('x', true), staticPart('/b')];
      const defaults = new OptionalParamDefaults('set-undefined');

      const result = expandOptional(parts, 0, defaults);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const dropped = result[1]!.parts;
        expect(dropped).toEqual([{ type: 'static', value: '/a/b', segments: ['a', 'b'] }]);
      }
    });
  });
});
