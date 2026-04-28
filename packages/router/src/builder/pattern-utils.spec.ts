import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { PatternUtils } from './pattern-utils';

describe('PatternUtils', () => {
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
