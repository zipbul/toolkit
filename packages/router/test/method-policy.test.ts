import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

describe('method token validation', () => {
  test('empty method must throw on add()/build()', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('whitespace method "GET POST" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET POST' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with control char "GET\\t" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET\t' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with delimiter "GET/" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET/' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method longer than 64 ASCII bytes must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('A'.repeat(65) as any, '/x', 'h');
      r.build();
    }).toThrow();
  });
});
