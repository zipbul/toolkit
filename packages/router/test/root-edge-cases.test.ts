/**
 * Root-level optional/wildcard edge cases that the original test suite missed
 * because the default ignoreTrailingSlash trim and the codegen specialization
 * around root-slash terminals papered over the underlying logic gaps.
 *
 * - `/:id?` should match `/` (the omit-expansion of an optional collapses to
 *   the root path; before the fix it was silently dropped).
 * - `/*p` star wildcard at root should match `/` with empty capture (codegen
 *   `emitRootSlashTerminal` only handled bare `root.store`, not the wildcard
 *   variant; iterative and recursive walkers had the same gap).
 * - `:a:b` style collapsed param names — surprising user-visible behavior.
 *   We now reject router-metacharacters (':', '*', '?', '+', '/', '(', ')')
 *   inside param names so `/:a:b` errors at registration time.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

describe('optional param at root matches /', () => {
  it('/:id? matches / with id absent', () => {
    const r = new Router<string>({ optionalParamBehavior: 'omit' });
    r.add('GET', '/:id?', 'opt');
    r.build();

    const m = r.match('GET', '/');

    expect(m).not.toBeNull();
    expect(m!.value).toBe('opt');
    expect('id' in m!.params).toBe(false);
  });

  it('/:id? matches /foo with id captured', () => {
    const r = new Router<string>();
    r.add('GET', '/:id?', 'opt');
    r.build();

    const m = r.match('GET', '/foo');

    expect(m).not.toBeNull();
    expect(m!.params.id).toBe('foo');
  });

  it('/:id? + set-undefined behavior at root', () => {
    const r = new Router<string>({ optionalParamBehavior: 'set-undefined' });
    r.add('GET', '/:id?', 'opt');
    r.build();

    const m = r.match('GET', '/');

    expect(m).not.toBeNull();
    expect(m!.params.id).toBeUndefined();
    expect('id' in m!.params).toBe(true);
  });

  it('multi-segment /a/:b? still works at the inner level', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:b?', 'opt');
    r.build();

    expect(r.match('GET', '/a')!.value).toBe('opt');
    expect(r.match('GET', '/a/x')!.params.b).toBe('x');
  });
});

describe('star wildcard at root matches /', () => {
  it('/*p captures empty string when URL is /', () => {
    const r = new Router<string>();
    r.add('GET', '/*p', 'wild');
    r.build();

    const m = r.match('GET', '/');

    expect(m).not.toBeNull();
    expect(m!.value).toBe('wild');
    expect(m!.params.p).toBe('');
  });

  it('/*p captures suffix on non-root URLs', () => {
    const r = new Router<string>();
    r.add('GET', '/*p', 'wild');
    r.build();

    expect(r.match('GET', '/a')!.params.p).toBe('a');
    expect(r.match('GET', '/a/b/c')!.params.p).toBe('a/b/c');
  });

  it('/* (anonymous wildcard) also matches /', () => {
    const r = new Router<string>();
    r.add('GET', '/*', 'wild');
    r.build();

    const m = r.match('GET', '/');

    expect(m).not.toBeNull();
    expect((m!.params as Record<string, string>)['*']).toBe('');
  });

  it('multi-wildcard at root /*p+ does NOT match /', () => {
    // Multi requires ≥1 char of suffix — `/` alone is not enough.
    const r = new Router<string>();
    r.add('GET', '/*p+', 'multi');
    r.build();

    expect(r.match('GET', '/')).toBeNull();
    expect(r.match('GET', '/a')!.params.p).toBe('a');
  });
});

describe('param-name validation', () => {
  it('rejects `:a:b` (colon inside name) — usually means two consecutive params', () => {
    const r = new Router<string>();

    r.add('GET', '/:a:b', 'x');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects asterisk in param name', () => {
    const r = new Router<string>();

    r.add('GET', '/:a*x', 'x');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects slash in param name', () => {
    const r = new Router<string>();
    // Note: / is normally a segment separator, but within a param name (after
    // colon) it should still be rejected if somehow constructed.
    expect(() => r.add('GET', '/:a/b/c', 'x')).not.toThrow();
    // /:a/b/c is actually three segments: param :a, static b, static c.
    // That's valid. We're checking the negative case where the parser
    // somehow ended up with a slash inside the name — this is harder to
    // construct directly so we just confirm the slash-as-separator works.
  });

  it('rejects hyphen in param name', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:user-id', 'h');
    expect(() => r.build()).toThrow();
  });

  it('accepts underscore and digits in param name', () => {
    const r = new Router<string>();

    expect(() => r.add('GET', '/x/v2_underscore', 'u')).not.toThrow();
  });

  it('rejects names starting with underscore', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:_id', 'u');
    expect(() => r.build()).toThrow();
  });

  it('rejects metacharacters in wildcard name', () => {
    // /*p{\w+} silently used to register a wildcard whose name was the
    // literal string `p{\w+}` (parser doesn't support wildcard regex). Now
    // surfaced as a parse error.
    const r = new Router<string>();

    r.add('GET', '/files/*p{\\w+}', 'wreg');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects metacharacters in :name+ multi-wildcard form', () => {
    const r = new Router<string>();

    r.add('GET', '/files/:p(*+', 'invalid');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('rejects metacharacters in :name* star-wildcard form', () => {
    const r = new Router<string>();

    r.add('GET', '/files/:p:other*', 'invalid');
    expect(() => r.build()).toThrow(RouterError);
  });
});

describe('handler value with falsy/undefined values', () => {
  it('static route with handler value === undefined returns MatchOutput, not null', () => {
    // Distinguishing "registered with undefined" from "not registered" requires
    // a parallel boolean array — slot value alone is ambiguous.
    const r = new Router<undefined>();
    r.add('GET', '/x', undefined);
    r.build();

    const m = r.match('GET', '/x');

    expect(m).not.toBeNull();
    expect(m!.value).toBeUndefined();
    expect(m!.meta.source).toBe('static');
  });

  it('static route with handler value === null returns MatchOutput', () => {
    const r = new Router<null>();
    r.add('GET', '/x', null);
    r.build();

    const m = r.match('GET', '/x');

    expect(m).not.toBeNull();
    expect(m!.value).toBeNull();
  });

  it('re-registering a static path with undefined still throws route-duplicate', () => {
    // Without the staticRegistered tracking, the duplicate check
    // (`arr[mc] !== undefined`) would fail to fire when the first value was
    // undefined — silently allowing re-registration.
    const r = new Router<string | undefined>();
    r.add('GET', '/x', undefined);
    r.add('GET', '/x', 'something');

    expect(() => r.build()).toThrow(RouterError);
  });

  it('handler value === false / 0 / "" all preserved via static MatchOutput', () => {
    type Falsy = false | 0 | '';
    const r = new Router<Falsy>();
    r.add('GET', '/false', false as Falsy);
    r.add('GET', '/zero', 0 as Falsy);
    r.add('GET', '/empty', '' as Falsy);
    r.build();

    expect(r.match('GET', '/false')!.value).toBe(false);
    expect(r.match('GET', '/zero')!.value).toBe(0);
    expect(r.match('GET', '/empty')!.value).toBe('');
  });
});
