import { describe, it, expect } from 'bun:test';
import { Router } from '../index';

describe('Parameter Naming Strictness (Bun Only)', () => {
  it('should allow snake_case and camelCase', () => {
    const r = new Router<number>();
    r.add('GET', '/u/:user_id', 1);
    r.add('GET', '/p/:postTitle', 2);
    r.add('GET', '/v/:v1_beta', 3);
    
    expect(() => r.build()).not.toThrow();
    expect(r.match('GET', '/u/42')?.params.user_id).toBe('42');
    expect(r.match('GET', '/p/hello')?.params.postTitle).toBe('hello');
    expect(r.match('GET', '/v/1')?.params.v1_beta).toBe('1');
  });

  it('should reject kebab-case', () => {
    const r = new Router<number>();
    r.add('GET', '/:user-id', 1);
    try {
      r.build();
      throw new Error('Should have thrown');
    } catch (e: any) {
      const error = e.data.errors[0].error;
      expect(error.message).toMatch(/Only alphanumeric characters and underscores/);
    }
  });

  it('should reject Unicode/Korean names', () => {
    const r = new Router<number>();
    r.add('GET', '/:사용자ID', 1);
    try {
      r.build();
      throw new Error('Should have thrown');
    } catch (e: any) {
      const error = e.data.errors[0].error;
      expect(error.message).toMatch(/start with a letter|alphanumeric characters/);
    }
  });

  it('should reject names starting with a digit', () => {
    const r = new Router<number>();
    r.add('GET', '/:123id', 1);
    try {
      r.build();
      throw new Error('Should have thrown');
    } catch (e: any) {
      const error = e.data.errors[0].error;
      expect(error.message).toMatch(/must start with a letter/);
    }
  });

  it('should reject names starting with an underscore', () => {
    const r = new Router<number>();
    r.add('GET', '/:_id', 1);
    try {
      r.build();
      throw new Error('Should have thrown');
    } catch (e: any) {
      const error = e.data.errors[0].error;
      expect(error.message).toMatch(/must start with a letter/);
    }
  });

  it('should reject names with spaces or symbols', () => {
    const r = new Router<number>();
    r.add('GET', '/:user id', 1);
    expect(() => r.build()).toThrow();
  });
});
