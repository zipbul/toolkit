import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

describe('registration path policy accepts well-formed routes', () => {
  test.each([
    ['/'],
    ['/users'],
    ['/users/:id'],
    ['/users/:id?'],
    ['/users/:id?/posts'],
    ['/files/*p'],
    ['/api/v1/_underscore/dot.token-and-tilde~'],
    ['/colon:literal'],
    ['/at@symbol'],
    ['/sub:!$&\'()*+,;='],
    ['/literal%23'],
    ['/literal%3F'],
    ['/users/:id(\\d+)'],
  ])('accepts %s', (path) => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', path, 'h');
      r.build();
    }).not.toThrow();
  });

});

describe('registration path validation', () => {
  test('path with raw query "/a?b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a?b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with raw fragment "/a#b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a#b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with C0 control char must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a\x01b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with literal dot segment "/a/../b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/../b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with literal "." segment must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/./b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with encoded-dot segment "/%2e%2e/b" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/%2e%2e/b', 'h');
      r.build();
    }).toThrow();
  });

  test('path with malformed percent "/a/%ZZ" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/%ZZ', 'h');
      r.build();
    }).toThrow();
  });

  test('path with raw non-ASCII byte must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET', '/a/한', 'h');
      r.build();
    }).toThrow();
  });
});

