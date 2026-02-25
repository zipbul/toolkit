import { describe, it, expect, beforeEach } from 'bun:test';

import { NodeKind } from '../schema';
import { Node } from './node';
import { StaticChildMap } from './static-child-map';

function makeNode(segment: string): Node {
  return new Node(NodeKind.Static, segment);
}

describe('StaticChildMap', () => {
  let map: StaticChildMap;

  beforeEach(() => {
    map = new StaticChildMap();
  });

  describe('empty map', () => {
    it('should have size 0 initially', () => {
      expect(map.size).toBe(0);
    });

    it('should return undefined for get on empty map', () => {
      expect(map.get('foo')).toBeUndefined();
    });
  });

  describe('inline mode (≤ INLINE_THRESHOLD entries)', () => {
    it('should set and get in inline mode', () => {
      const node = makeNode('child');
      map.set('child', node);
      expect(map.get('child')).toBe(node);
      expect(map.size).toBe(1);
    });

    it('should update existing key in inline mode', () => {
      const n1 = makeNode('a');
      const n2 = makeNode('a-updated');
      map.set('foo', n1);
      map.set('foo', n2);
      expect(map.get('foo')).toBe(n2);
      expect(map.size).toBe(1);
    });

    it('should hold up to 4 entries in inline mode', () => {
      for (let i = 1; i <= 4; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      expect(map.size).toBe(4);
      expect(map.get('seg1')).toBeDefined();
      expect(map.get('seg4')).toBeDefined();
    });
  });

  describe('promotion to sorted mode (> INLINE_THRESHOLD)', () => {
    it('should promote when 5th entry is added', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      expect(map.size).toBe(5);
      // すべてのキーにアクセスできる
      for (let i = 1; i <= 5; i++) {
        expect(map.get(`seg${i}`)).toBeDefined();
      }
    });

    it('should update existing key in sorted mode', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      const updated = makeNode('replaced');
      map.set('seg3', updated);
      expect(map.get('seg3')).toBe(updated);
      expect(map.size).toBe(5);
    });

    it('should add new key in sorted mode', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      const extra = makeNode('extra');
      map.set('extra', extra);
      expect(map.size).toBe(6);
      expect(map.get('extra')).toBe(extra);
    });

    it('should return undefined for missing key in sorted mode', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      expect(map.get('notexist')).toBeUndefined();
    });
  });

  describe('clear()', () => {
    it('should reset size and entries in inline mode', () => {
      map.set('a', makeNode('a'));
      map.set('b', makeNode('b'));
      map.clear();
      expect(map.size).toBe(0);
      expect(map.get('a')).toBeUndefined();
    });

    it('should reset size and entries in sorted mode', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      map.clear();
      expect(map.size).toBe(0);
      expect(map.get('seg1')).toBeUndefined();
    });
  });

  describe('fromEntries()', () => {
    it('should build map from iterable entries', () => {
      const n1 = makeNode('x');
      const n2 = makeNode('y');
      const result = StaticChildMap.fromEntries([
        ['x', n1],
        ['y', n2],
      ]);
      expect(result.size).toBe(2);
      expect(result.get('x')).toBe(n1);
      expect(result.get('y')).toBe(n2);
    });
  });

  describe('iteration', () => {
    it('should iterate entries in inline mode', () => {
      const n1 = makeNode('a');
      const n2 = makeNode('b');
      map.set('a', n1);
      map.set('b', n2);
      const entries = [...map.entries()];
      expect(entries).toHaveLength(2);
      const keys = entries.map(([k]) => k);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('should iterate via Symbol.iterator in sorted mode', () => {
      for (let i = 1; i <= 5; i++) {
        map.set(`seg${i}`, makeNode(`seg${i}`));
      }
      const collected: string[] = [];
      for (const [key] of map) {
        collected.push(key);
      }
      expect(collected).toHaveLength(5);
    });

    it('should iterate keys() and values() correctly', () => {
      map.set('alpha', makeNode('alpha'));
      map.set('beta', makeNode('beta'));
      const keys = [...map.keys()];
      const values = [...map.values()];
      expect(keys).toHaveLength(2);
      expect(values).toHaveLength(2);
      expect(keys).toContain('alpha');
    });
  });
});
