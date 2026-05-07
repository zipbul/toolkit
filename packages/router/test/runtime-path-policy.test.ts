import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

describe('runtime secure path policy: percent escapes', () => {
  test('malformed percent in path must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%ZZ')).toBeNull();
  });

  test('encoded slash %2F inside param capture must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/files/:name', 'h');
    r.build();
    expect(r.match('GET', '/files/a%2Fb')).toBeNull();
  });

  test('encoded slash inside wildcard capture must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'h');
    r.build();
    expect(r.match('GET', '/files/a%2Fb')).toBeNull();
  });

  test('encoded control %00 must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%00')).toBeNull();
  });

  test('encoded control %1f must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%1f')).toBeNull();
  });

  test('encoded DEL %7f must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%7f')).toBeNull();
  });

  test('overlong UTF-8 %C0%AF must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%C0%AF')).toBeNull();
  });

  test('overlong UTF-8 %E0%80%AF must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%E0%80%AF')).toBeNull();
  });

  test('UTF-8 surrogate range %ED%A0%80 must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%ED%A0%80')).toBeNull();
  });

  test('out-of-range UTF-8 starter %F5%80%80%80 must no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%F5%80%80%80')).toBeNull();
  });

  test('%252F decodes once to %2F (no double-decode into /)', () => {
    const r = new Router<string>();
    r.add('GET', '/files/:name', 'h');
    r.build();
    const m = r.match('GET', '/files/a%252Fb');
    expect(m).not.toBeNull();
    expect(m!.params.name).toBe('a%2Fb');
  });
});

describe('runtime secure path policy: fragment and control bytes', () => {
  test('raw # anywhere returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/foo#bar')).toBeNull();
  });

  test('raw control byte returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/foo\x01bar')).toBeNull();
  });

  test('raw non-ASCII byte returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/한')).toBeNull();
  });
});

describe('runtime secure path policy: dot segments', () => {
  test('literal /../ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/../b')).toBeNull();
  });

  test('literal /./ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/./b')).toBeNull();
  });

  test('encoded /%2e%2e/ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/%2e%2e/b')).toBeNull();
  });

  test('encoded /%2E%2E/ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/%2E%2E/b')).toBeNull();
  });

  test('mixed /.%2e/ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/.%2e/b')).toBeNull();
  });

  test('mixed /%2e./ returns no-match', () => {
    const r = new Router<string>();
    r.add('GET', '/a/b', 'h');
    r.build();
    expect(r.match('GET', '/a/%2e./b')).toBeNull();
  });

  test('.well-known is not a dot segment', () => {
    const r = new Router<string>();
    r.add('GET', '/.well-known/x', 'h');
    r.build();
    expect(r.match('GET', '/.well-known/x')?.value).toBe('h');
  });

  test('triple-dot ... is not a dot segment', () => {
    const r = new Router<string>();
    r.add('GET', '/.../x', 'h');
    r.build();
    expect(r.match('GET', '/.../x')?.value).toBe('h');
  });
});

describe('runtime secure path policy: unsafe input is not cached', () => {
  test('a malformed runtime path does not pollute the miss cache for subsequent valid lookups', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/%ZZ')).toBeNull();
    expect(r.match('GET', '/a/safe')?.value).toBe('h');
  });
});

describe('compat profile relaxes runtime policy', () => {
  test('compat passes malformed percent through', () => {
    const r = new Router<string>({ profile: 'compat' });
    r.add('GET', '/a/:x', 'h');
    r.build();
    const m = r.match('GET', '/a/bad%GG');
    expect(m).not.toBeNull();
  });

  test('compat passes raw non-ASCII through', () => {
    const r = new Router<string>({ profile: 'compat' });
    r.add('GET', '/a/:x', 'h');
    r.build();
    const m = r.match('GET', '/a/한');
    expect(m).not.toBeNull();
  });

  test('compat still rejects raw fragment', () => {
    const r = new Router<string>({ profile: 'compat' });
    r.add('GET', '/a/:x', 'h');
    r.build();
    expect(r.match('GET', '/a/foo#bar')).toBeNull();
  });
});
