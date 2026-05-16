import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';
import type { RouterErrorKind } from '../src/types';
import { firstBuildIssue } from './test-utils';

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
    r.add('GET', path, 'h');
    r.build();
    // No throw and no validation issue — the route is registered AND
    // can match. Probing the registered path proves the build accepted
    // the structure (not just absence of throw).
    expect(r.match('GET', path.replace(/:[a-z]+\??/g, 'val').replace(/\*[a-z]+/g, 'tail'))).not.toBeUndefined();
  });
});

describe('registration path policy rejects ill-formed routes', () => {
  const cases: Array<[string, string, RouterErrorKind]> = [
    ['raw query',                 '/a?b',         'path-query'],
    ['raw fragment',              '/a#b',         'path-fragment'],
    ['C0 control char',           '/a\x01b',      'path-control-char'],
    ['literal `..` segment',      '/a/../b',      'path-dot-segment'],
    ['literal `.` segment',       '/a/./b',       'path-dot-segment'],
    ['encoded `..` segment',      '/a/%2e%2e/b',  'path-dot-segment'],
    ['malformed percent escape',  '/a/%ZZ',       'path-malformed-percent'],
    ['raw non-ASCII byte',        '/a/한',        'path-non-ascii'],
  ];

  test.each(cases)('rejects %s with %s issue kind', (_label, path, expectedKind) => {
    const r = new Router<string>();
    r.add('GET', path, 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(expectedKind);
  });
});
