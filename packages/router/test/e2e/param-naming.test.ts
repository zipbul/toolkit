import { describe, it, expect } from 'bun:test';

import { Router } from '../../index';
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
    expect(issue.kind).toBe('route-parse');
    expect(issue.message).toMatch(/Only alphanumeric characters and underscores/);
  });

  it('rejects Unicode names — param-name grammar rejects non-ASCII first character', () => {
    const r = new Router<number>();
    r.add('GET', '/:사용자ID', 1);
    const issue = firstBuildIssue(r);
    // Non-ASCII bytes in *static* segments are now accepted (IRI), but a
    // *param name* must follow the snake_case / camelCase grammar and
    // start with an ASCII letter.
    expect(issue.kind).toBe('route-parse');
  });

  it('rejects names starting with a digit', () => {
    const r = new Router<number>();
    r.add('GET', '/:123id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect(issue.message).toMatch(/must start with a letter/);
  });

  it('rejects names starting with an underscore', () => {
    const r = new Router<number>();
    r.add('GET', '/:_id', 1);
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect(issue.message).toMatch(/must start with a letter/);
  });

  it('rejects names with embedded whitespace (caught by the path-grammar gate)', () => {
    const r = new Router<number>();
    r.add('GET', '/:user id', 1);
    const issue = firstBuildIssue(r);
    // The space (0x20) is outside the path-segment pchar grammar, so
    // path-policy rejects the route before parseParam sees the name.
    expect(issue.kind).toBe('path-invalid-pchar');
  });
});
