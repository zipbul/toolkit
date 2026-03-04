import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { RadixBuilder } from './radix-builder';
import type { BuilderConfig } from './types';
import type { PathPart } from './path-parser';

function defaultConfig(overrides: Partial<BuilderConfig> = {}): BuilderConfig {
  return {
    regexSafety: { mode: 'error', maxLength: 256, forbidBacktrackingTokens: true, forbidBackreferences: true },
    ...overrides,
  };
}

function staticPart(value: string): PathPart {
  return { type: 'static', value };
}

function paramPart(name: string, pattern: string | null = null, optional = false): PathPart {
  return { type: 'param', name, pattern, optional };
}

function wildcardPart(name: string, origin: 'star' | 'multi' = 'star'): PathPart {
  return { type: 'wildcard', name, origin };
}

describe('RadixBuilder', () => {
  describe('getRoot', () => {
    it('should return null for method with no routes', () => {
      const builder = new RadixBuilder(defaultConfig());
      expect(builder.getRoot(0)).toBeNull();
    });

    it('should return root node after insertion', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users')], 0);
      expect(builder.getRoot(0)).not.toBeNull();
    });
  });

  describe('static insertion', () => {
    it('should insert a single static route', () => {
      const builder = new RadixBuilder(defaultConfig());
      const result = builder.insert(0, [staticPart('/users')], 0);

      expect(isErr(result)).toBe(false);

      const root = builder.getRoot(0)!;
      expect(root).not.toBeNull();
    });

    it('should split nodes on LCP divergence', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users')], 0);
      builder.insert(0, [staticPart('/utils')], 1);

      const root = builder.getRoot(0)!;
      // Root should have inert child at '/' charCode
      expect(root.inert).not.toBeNull();

      const slashChild = root.inert![47]; // '/'
      expect(slashChild).toBeDefined();
      // Should have been split at common prefix '/u'
      expect(slashChild!.part).toBe('/u');
    });

    it('should handle shared prefix routes', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/api/users')], 0);
      builder.insert(0, [staticPart('/api/posts')], 1);

      const root = builder.getRoot(0)!;
      const slashChild = root.inert![47]!;
      // /api/ is the common prefix
      expect(slashChild.part).toBe('/api/');
    });
  });

  describe('param insertion', () => {
    it('should insert a param route', () => {
      const builder = new RadixBuilder(defaultConfig());
      const result = builder.insert(0, [staticPart('/users/'), paramPart('id')], 0);

      expect(isErr(result)).toBe(false);
    });

    it('should detect param conflict (same name, different pattern)', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users/'), paramPart('id', '\\d+')], 0);
      const result = builder.insert(0, [staticPart('/users/'), paramPart('id', '[a-z]+')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-conflict');
    });
  });

  describe('wildcard insertion', () => {
    it('should insert a wildcard route', () => {
      const builder = new RadixBuilder(defaultConfig());
      const result = builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 0);

      expect(isErr(result)).toBe(false);
    });

    it('should detect wildcard conflict with different name', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 0);
      const result = builder.insert(0, [staticPart('/files/'), wildcardPart('file')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-conflict');
    });

    it('should detect wildcard duplicate with same name', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 0);
      const result = builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-duplicate');
    });

    it('should detect wildcard-param conflict', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 0);
      const result = builder.insert(0, [staticPart('/files/'), paramPart('id')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-conflict');
    });

    it('should detect param-wildcard conflict', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/files/'), paramPart('id')], 0);
      const result = builder.insert(0, [staticPart('/files/'), wildcardPart('path')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-conflict');
    });
  });

  describe('duplicate detection', () => {
    it('should detect duplicate static routes', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users')], 0);
      const result = builder.insert(0, [staticPart('/users')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-duplicate');
    });

    it('should detect duplicate param routes', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users/'), paramPart('id')], 0);
      const result = builder.insert(0, [staticPart('/users/'), paramPart('id')], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-duplicate');
    });
  });

  describe('per-method trie', () => {
    it('should maintain independent trees per method', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users')], 0);
      builder.insert(1, [staticPart('/posts')], 1);

      expect(builder.getRoot(0)).not.toBeNull();
      expect(builder.getRoot(1)).not.toBeNull();

      // Trees are independent
      const root0 = builder.getRoot(0)!;
      const root1 = builder.getRoot(1)!;
      expect(root0.inert![47]!.part).toBe('/users');
      expect(root1.inert![47]!.part).toBe('/posts');
    });
  });

  describe('optional params', () => {
    it('should expand optional param into two insertion paths', () => {
      const builder = new RadixBuilder(defaultConfig());
      const result = builder.insert(0, [
        staticPart('/users/'),
        paramPart('id', null, true),
      ], 0);

      expect(isErr(result)).toBe(false);
      // Both /users/:id and /users should be in the trie
      const root = builder.getRoot(0)!;
      expect(root).not.toBeNull();
    });

    it('should record optional param defaults', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [
        staticPart('/users/'),
        paramPart('id', null, true),
      ], 0);

      expect(builder.optionalParamDefaults).toBeDefined();
    });
  });

  describe('getTesters', () => {
    it('should return empty array for method with no testers', () => {
      const builder = new RadixBuilder(defaultConfig());
      expect(builder.getTesters(0)).toEqual([]);
    });

    it('should return tester for regex param', () => {
      const builder = new RadixBuilder(defaultConfig());
      builder.insert(0, [staticPart('/users/'), paramPart('id', '\\d+')], 0);

      const testers = builder.getTesters(0);
      expect(testers.length).toBeGreaterThan(0);
    });
  });
});
