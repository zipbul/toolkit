import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { PatternUtils } from './pattern-utils';

describe('PatternUtils', () => {
  describe('acquireCompiledPattern', () => {
    it('should return a RegExp that matches the given source and flags', () => {
      const utils = new PatternUtils({});
      const regex = utils.acquireCompiledPattern('\\d+', '');

      expect(regex.test('123')).toBe(true);
      expect(regex.test('abc')).toBe(false);
    });

    it('should return the same RegExp instance for identical source and flags (cache hit)', () => {
      const utils = new PatternUtils({});
      const r1 = utils.acquireCompiledPattern('\\d+', '');
      const r2 = utils.acquireCompiledPattern('\\d+', '');

      expect(r1).toBe(r2);
    });

    it('should return different RegExp instances for different sources', () => {
      const utils = new PatternUtils({});
      const r1 = utils.acquireCompiledPattern('\\d+', '');
      const r2 = utils.acquireCompiledPattern('[a-z]+', '');

      expect(r1).not.toBe(r2);
    });

    it('should differentiate cache keys by flags', () => {
      const utils = new PatternUtils({});
      const r1 = utils.acquireCompiledPattern('abc', '');
      const r2 = utils.acquireCompiledPattern('abc', 'i');

      expect(r1).not.toBe(r2);
    });
  });

  describe('normalizeParamPatternSource', () => {
    it('should return clean pattern unchanged when no anchors are present (policy=silent)', () => {
      const utils = new PatternUtils({ regexAnchorPolicy: 'silent' });
      const result = utils.normalizeParamPatternSource('\\d+');

      expect(isErr(result)).toBe(false);
      expect(result).toBe('\\d+');
    });

    it('should strip leading ^ anchor from pattern (policy=silent)', () => {
      const utils = new PatternUtils({ regexAnchorPolicy: 'silent' });
      const result = utils.normalizeParamPatternSource('^\\d+');

      expect(isErr(result)).toBe(false);
      expect(result).toBe('\\d+');
    });

    it('should strip trailing $ anchor from pattern (policy=silent)', () => {
      const utils = new PatternUtils({ regexAnchorPolicy: 'silent' });
      const result = utils.normalizeParamPatternSource('\\d+$');

      expect(isErr(result)).toBe(false);
      expect(result).toBe('\\d+');
    });

    it('should return Err(regex-anchor) when pattern has anchor and policy is error', () => {
      const utils = new PatternUtils({ regexAnchorPolicy: 'error' });
      const result = utils.normalizeParamPatternSource('^\\d+$');

      expect(isErr(result)).toBe(true);
      expect((result as any).data.kind).toBe('regex-anchor');
    });

    it('should call onWarn and return stripped pattern when policy is warn', () => {
      const warnings: string[] = [];
      const utils = new PatternUtils({
        regexAnchorPolicy: 'warn',
        onWarn: w => warnings.push(w.kind),
      });
      const result = utils.normalizeParamPatternSource('^\\d+');

      expect(isErr(result)).toBe(false);
      expect(result).toBe('\\d+');
      expect(warnings).toContain('regex-anchor');
    });

    it('should normalize pattern with only anchors to .* ', () => {
      const utils = new PatternUtils({ regexAnchorPolicy: 'silent' });
      const result = utils.normalizeParamPatternSource('^$');

      expect(isErr(result)).toBe(false);
      expect(result).toBe('.*');
    });
  });
});
