import { describe, test, expect } from 'bun:test';

import { firstBuildIssue } from '../../test/test-utils';
import { Router } from '../router';
import { RouterErrorKind } from '../types';

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
    ["/sub:!$&'()*+,;="],
    ['/literal%23'],
    ['/literal%3F'],
    ['/users/:id(\\d+)'],
  ])('accepts %s', path => {
    const r = new Router<string>();
    r.add('GET', path, 'h');
    r.build();
    expect(r.match('GET', path.replace(/:[a-z]+\??/g, 'val').replace(/\*[a-z]+/g, 'tail'))).not.toBeUndefined();
  });
});

describe('registration path policy rejects ill-formed routes', () => {
  const cases: Array<[string, string, RouterErrorKind]> = [
    ['raw query', '/a?b', RouterErrorKind.PathQuery],
    ['raw fragment', '/a#b', RouterErrorKind.PathFragment],
    ['C0 control char', '/a\x01b', RouterErrorKind.PathControlChar],
    ['literal `..` segment', '/a/../b', RouterErrorKind.PathDotSegment],
    ['literal `.` segment', '/a/./b', RouterErrorKind.PathDotSegment],
    ['encoded `..` segment', '/a/%2e%2e/b', RouterErrorKind.PathDotSegment],
    ['malformed percent escape', '/a/%ZZ', RouterErrorKind.PathMalformedPercent],
  ];

  test.each(cases)('rejects %s with %s issue kind', (_label, path, expectedKind) => {
    const r = new Router<string>();
    r.add('GET', path, 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(expectedKind);
  });
});

describe('IRI registration (RFC 3987) — raw Unicode is normalized to URI form', () => {
  test('accepts a raw Unicode static segment and normalizes it to percent-encoded UTF-8', () => {
    const r = new Router<string>();
    r.add('GET', '/users/한국', 'h');
    r.build();
    expect(r.match('GET', '/users/%ED%95%9C%EA%B5%AD')?.value).toBe('h');
  });

  test('IRI and URI form of the same path are duplicates at registration time', () => {
    const r = new Router<string>();
    r.add('GET', '/users/한국', 'a');
    r.add('GET', '/users/%ED%95%9C%EA%B5%AD', 'b');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteDuplicate);
  });

  test('NFC normalization collapses decomposed and composed forms to one route', () => {
    const decomposed = '/users/A\u030A';
    const composed = '/users/\u00C5';
    const r = new Router<string>();
    r.add('GET', decomposed, 'a');
    r.add('GET', composed, 'b');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.RouteDuplicate);
  });

  test('mixed IRI + ASCII segments are normalized correctly', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/사용자/list', 'h');
    r.build();
    expect(r.match('GET', '/api/v1/%EC%82%AC%EC%9A%A9%EC%9E%90/list')?.value).toBe('h');
  });

  test('4-byte UTF-8 codepoints (e.g. emoji) encode as 4 percent groups', () => {
    const r = new Router<string>();
    r.add('GET', '/p/😀', 'h');
    r.build();
    expect(r.match('GET', '/p/%F0%9F%98%80')?.value).toBe('h');
  });

  test('pure-ASCII path is unchanged (fast path)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/42', 'h');
    r.build();
    expect(r.match('GET', '/users/42')?.value).toBe('h');
  });
});

describe('percent-decode UTF-8 validation (validateDecodedBytes)', () => {
  const utf8Cases: Array<[string, string, RouterErrorKind]> = [
    ['encoded slash %2F', '/a/%2F', RouterErrorKind.PathEncodedSlash],
    ['stray continuation byte 0x80', '/a/%80', RouterErrorKind.PathInvalidUtf8],
    ['overlong 2-byte lead 0xC0', '/a/%C0%80', RouterErrorKind.PathInvalidUtf8],
    ['overlong 2-byte lead 0xC1', '/a/%C1%80', RouterErrorKind.PathInvalidUtf8],
    ['invalid 4-byte lead 0xF5', '/a/%F5%80%80%80', RouterErrorKind.PathInvalidUtf8],
    ['invalid lead byte 0xFF', '/a/%FF', RouterErrorKind.PathInvalidUtf8],
    ['truncated UTF-8 sequence', '/a/%E4b', RouterErrorKind.PathInvalidUtf8],
    ['continuation without lead', '/a/%C2/x', RouterErrorKind.PathInvalidUtf8],
    ['UTF-16 surrogate codepoint', '/a/%ED%A0%80', RouterErrorKind.PathInvalidUtf8],
    ['codepoint above U+10FFFF', '/a/%F4%90%80%80', RouterErrorKind.PathInvalidUtf8],
    ['overlong 3-byte sequence', '/a/%E0%80%80', RouterErrorKind.PathInvalidUtf8],
    ['overlong 4-byte sequence', '/a/%F0%80%80%80', RouterErrorKind.PathInvalidUtf8],
    ['trailing incomplete UTF-8', '/a/%C2', RouterErrorKind.PathInvalidUtf8],
  ];

  test.each(utf8Cases)('rejects %s with %s issue kind', (_label, path, expectedKind) => {
    const r = new Router<string>();
    r.add('GET', path, 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(expectedKind);
  });

  test('accepts a valid multi-byte UTF-8 codepoint encoded in the path (e.g. 一 → %E4%B8%80)', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%E4%B8%80', 'h');
    expect(() => r.build()).not.toThrow();
  });

  test('accepts a valid 4-byte UTF-8 codepoint (e.g. 😀 → %F0%9F%98%80)', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%F0%9F%98%80', 'h');
    expect(() => r.build()).not.toThrow();
  });

  test('skips validation inside a regex paren group — `(?:%FF)` is allowed as raw regex source', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(a%20b)', 'h');
    expect(() => r.build()).not.toThrow();
  });

  test('rejects a dot segment inside a path that follows a regex paren group', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)/..', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.PathDotSegment);
  });

  test('rejects a dot segment inside a balanced regex group that crosses a slash (line 80-85 branch)', () => {
    const r = new Router<string>();
    r.add('GET', '/foo(/../bar)', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe(RouterErrorKind.PathDotSegment);
  });
});

describe('lowercase hex digit parsing (hexValue a-f branch)', () => {
  test('decodes lowercase hex digits in percent-escapes', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%e4%b8%80', 'h');
    expect(() => r.build()).not.toThrow();
  });
});
