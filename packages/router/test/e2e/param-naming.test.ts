import { describe, it, expect } from 'bun:test';

import { Router } from '../../index';
import { RouterErrorKind } from '../../src/types';
import { firstBuildIssue } from '../test-utils';

describe('parameter name grammar', () => {
  it('accepts snake_case and camelCase names', () => {
    const r = new Router<number>();
    r.add('GET', '/u/:user_id', 1);
    r.add('GET', '/p/:postTitle', 2);
    r.add('GET', '/v/:v1_beta', 3);
    r.build();

    expect(r.match('GET', '/u/42')?.params.user_id).toBe('42');
    expect(r.match('GET', '/p/hello')?.params.postTitle).toBe('hello');
    expect(r.match('GET', '/v/1')?.params.v1_beta).toBe('1');
  });

  it('rejects kebab-case (hyphen is outside the name grammar)', () => {
    const r = new Router<number>();
    r.add('GET', '/:user-id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteParse);
    expect(issue.message).toMatch(/Only alphanumeric characters and underscores/);
  });

  it('rejects Unicode names — param-name grammar rejects non-ASCII first character', () => {
    const r = new Router<number>();
    r.add('GET', '/:사용자ID', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteParse);
  });

  it('rejects names starting with a digit', () => {
    const r = new Router<number>();
    r.add('GET', '/:123id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteParse);
    expect(issue.message).toMatch(/must start with a letter/);
  });

  it('rejects names starting with an underscore', () => {
    const r = new Router<number>();
    r.add('GET', '/:_id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteParse);
    expect(issue.message).toMatch(/must start with a letter/);
  });

  it('rejects names with embedded whitespace (caught by the path-grammar gate)', () => {
    const r = new Router<number>();
    r.add('GET', '/:user id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.PathInvalidPchar);
  });
});
