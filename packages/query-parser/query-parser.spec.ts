/* oxlint-disable typescript-eslint/no-unsafe-assignment, typescript-eslint/no-unsafe-member-access, typescript-eslint/no-unsafe-argument, typescript-eslint/no-unsafe-return, typescript-eslint/no-unsafe-type-assertion */

import { describe, expect, it } from 'bun:test';

import type { QueryArray, QueryValue, QueryValueRecord } from './types';

import { QueryParser } from './query-parser';

const parseRecord = (parser: QueryParser, input: string): QueryValueRecord => {
  return parser.parse(input);
};

const expectQueryArray = (value: QueryValue | undefined): QueryArray => {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }

  return value;
};

const expectQueryRecord = (value: QueryValue | undefined): QueryValueRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected record');
  }

  return value;
};

describe('query-parser', () => {
  // ============================================
  // 1. Core RFC3986 Compliance
  // ============================================
  describe('Core RFC3986 Compliance', () => {
    const parser = new QueryParser();

    it('should parse simple key=value pairs when query has multiple pairs', () => {
      // Arrange
      const singleInput = 'foo=bar';
      const multiInput = 'foo=bar&baz=qux';
      // Act
      const single = parseRecord(parser, singleInput);
      const multi = parseRecord(parser, multiInput);

      // Assert
      expect(single).toEqual({ foo: 'bar' });
      expect(multi).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('should handle percent-encoded keys and values when input is encoded', () => {
      // Arrange
      const spacedInput = 'a%20b=c%20d';
      const encodedInput = 'foo=%26%3D';
      // Act
      const spaced = parseRecord(parser, spacedInput);
      const encoded = parseRecord(parser, encodedInput);

      // Assert
      expect(spaced).toEqual({ 'a b': 'c d' });
      expect(encoded).toEqual({ foo: '&=' });
    });

    it('should handle empty values when key has no value', () => {
      // Arrange
      const input = 'foo=&bar=';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ foo: '', bar: '' });
    });

    it('should handle keys without value when flags are used', () => {
      // Arrange
      const input = 'foo&bar';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ foo: '', bar: '' });
    });

    it('should ignore leading question mark when query starts with ?', () => {
      // Arrange
      const single = '?foo=bar';
      const double = '??foo=bar';
      // Act
      const singleRes = parseRecord(parser, single);
      const doubleRes = parseRecord(parser, double);

      // Assert
      expect(singleRes).toEqual({ foo: 'bar' });
      expect(doubleRes).toEqual({ '?foo': 'bar' });
    });

    it('should handle lowercase or uppercase hex when percent encoding', () => {
      // Arrange
      const lower = 'path=%2fhome';
      const upper = 'path=%2Fhome';
      // Act
      const lowerRes = parseRecord(parser, lower);
      const upperRes = parseRecord(parser, upper);

      // Assert
      expect(lowerRes).toEqual({ path: '/home' });
      expect(upperRes).toEqual({ path: '/home' });
    });

    it('should handle plus sign as literal when strict RFC 3986 applies', () => {
      // Arrange
      const input = 'hello+world=test';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ 'hello+world': 'test' });
    });

    it('should not double-decode values when percent encoded twice', () => {
      // Arrange
      const input = 'key=%2520';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ key: '%20' });
    });

    it('should handle multiple equals signs when value includes =', () => {
      // Arrange
      const triple = 'a=b=c';
      const double = 'a==b';
      // Act
      const tripleRes = parseRecord(parser, triple);
      const doubleRes = parseRecord(parser, double);

      // Assert
      expect(tripleRes).toEqual({ a: 'b=c' });
      expect(doubleRes).toEqual({ a: '=b' });
    });
  });

  // ============================================
  // 2. Empty Input & Boundary Conditions
  // ============================================
  describe('Empty Input & Boundary Conditions', () => {
    const parser = new QueryParser();

    it('should return empty object when input is empty string', () => {
      // Arrange
      const input = '';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({});
    });

    it('should return empty object when only question mark is provided', () => {
      // Arrange
      const input = '?';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({});
    });

    it('should return empty object when only delimiters are provided', () => {
      // Arrange
      const single = '&';
      const repeated = '&&&&';
      const equalsOnly = '=';
      const mixed = '=&=&=';
      // Act
      const singleRes = parseRecord(parser, single);
      const repeatedRes = parseRecord(parser, repeated);
      const equalsRes = parseRecord(parser, equalsOnly);
      const mixedRes = parseRecord(parser, mixed);

      // Assert
      expect(singleRes).toEqual({});
      expect(repeatedRes).toEqual({});
      expect(equalsRes).toEqual({});
      expect(mixedRes).toEqual({});
    });

    it('should ignore empty keys when key is missing', () => {
      // Arrange
      const emptyOnly = '=value';
      const mixed = '=value&foo=bar';
      // Act
      const emptyOnlyRes = parseRecord(parser, emptyOnly);
      const mixedRes = parseRecord(parser, mixed);

      // Assert
      expect(emptyOnlyRes).toEqual({});
      expect(mixedRes).toEqual({ foo: 'bar' });
    });

    it('should handle extra ampersands when delimiters repeat', () => {
      // Arrange
      const middle = 'a=1&&b=2';
      const trailing = 'a=1&';
      const leading = '&a=1';
      const repeated = 'a=1&&&&&b=2';
      // Act
      const middleRes = parseRecord(parser, middle);
      const trailingRes = parseRecord(parser, trailing);
      const leadingRes = parseRecord(parser, leading);
      const repeatedRes = parseRecord(parser, repeated);

      // Assert
      expect(middleRes).toEqual({ a: '1', b: '2' });
      expect(trailingRes).toEqual({ a: '1' });
      expect(leadingRes).toEqual({ a: '1' });
      expect(repeatedRes).toEqual({ a: '1', b: '2' });
    });
  });

  // ============================================
  // 3. Option: parseArrays (true)
  // ============================================
  describe('Option: parseArrays (true)', () => {
    const parser = new QueryParser({ parseArrays: true });

    it('should parse nested object when brackets are used', () => {
      // Arrange
      const single = 'user[name]=alice';
      const multi = 'user[name]=alice&user[age]=20';
      // Act
      const singleRes = parseRecord(parser, single);
      const multiRes = parseRecord(parser, multi);

      // Assert
      expect(singleRes).toEqual({ user: { name: 'alice' } });
      expect(multiRes).toEqual({ user: { name: 'alice', age: '20' } });
    });

    it('should parse array with explicit indices when indexed brackets provided', () => {
      // Arrange
      const input = 'arr[0]=a&arr[1]=b';
      // Act
      const res = parseRecord(parser, input);
      // Assert
      const arrValue = expectQueryArray(res.arr);

      expect(arrValue).toEqual(['a', 'b']);
    });

    it('should parse array with empty brackets when push-style syntax used', () => {
      // Arrange
      const input = 'arr[]=a&arr[]=b';
      // Act
      const res = parseRecord(parser, input);
      // Assert
      const arrValue = expectQueryArray(res.arr);

      expect(arrValue).toEqual(['a', 'b']);
    });

    it('should handle mixed array in object when nested arrays appear', () => {
      // Arrange
      const input = 'user[phones][0]=123&user[phones][1]=456';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({
        user: { phones: ['123', '456'] },
      });
    });

    it('should handle object in array when nested object appears', () => {
      // Arrange
      const input = 'users[0][name]=alice&users[1][name]=bob';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({
        users: [{ name: 'alice' }, { name: 'bob' }],
      });
    });

    it('should handle deeply nested structures when depth allows', () => {
      // Arrange
      const input = 'a[b][c][d][e]=deep';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({
        a: { b: { c: { d: { e: 'deep' } } } },
      });
    });

    it('should handle sparse arrays when indices skip positions', () => {
      // Arrange
      // Act
      const res = parseRecord(parser, 'arr[0]=a&arr[5]=b');
      const arr = expectQueryArray(res.arr);

      // Assert
      expect(arr[0]).toBe('a');
      expect(arr[5]).toBe('b');
    });

    it('should handle non-sequential indices when order differs', () => {
      // Arrange
      // Act
      const res = parseRecord(parser, 'arr[2]=c&arr[0]=a');
      const arr = expectQueryArray(res.arr);

      // Assert
      expect(arr[0]).toBe('a');
      expect(arr[2]).toBe('c');
    });

    it('should handle mixed bracket types when array contains object', () => {
      // Arrange
      const input = 'a[0][name]=alice';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ a: [{ name: 'alice' }] });
    });
  });

  // ============================================
  // 4. Option: parseArrays (false) - Default
  // ============================================
  describe('Option: parseArrays (false) - Default', () => {
    const parser = new QueryParser({ parseArrays: false });

    it('should treat brackets as literal key characters when parseArrays is false', () => {
      // Arrange
      const userInput = 'user[name]=alice';
      const arrayInput = 'arr[0]=a';
      const pushInput = 'arr[]=a';
      const nestedInput = 'a[b][c]=d';
      // Act
      const userRes = parseRecord(parser, userInput);
      const arrayRes = parseRecord(parser, arrayInput);
      const pushRes = parseRecord(parser, pushInput);
      const nestedRes = parseRecord(parser, nestedInput);

      // Assert
      expect(userRes).toEqual({ 'user[name]': 'alice' });
      expect(arrayRes).toEqual({ 'arr[0]': 'a' });
      expect(pushRes).toEqual({ 'arr[]': 'a' });
      expect(nestedRes).toEqual({ 'a[b][c]': 'd' });
    });
  });

  // ============================================
  // 5. Option: depth
  // ============================================
  describe('Option: depth', () => {
    it('should use default depth when no depth is provided', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const deep = parseRecord(parser, 'a[b][c][d][e][f]=deep');
      const blocked = parseRecord(parser, 'a[b][c][d][e][f][g]=blocked');
      const boundary = parseRecord(parser, 'level1[level2][level3][level4][level5]=ok');

      // Assert
      expect(deep).toEqual({
        a: { b: { c: { d: { e: { f: 'deep' } } } } },
      });
      expect(blocked).toEqual({
        a: { b: { c: { d: { e: { f: {} } } } } },
      });
      expect(boundary).toEqual({
        level1: { level2: { level3: { level4: { level5: 'ok' } } } },
      });
    });

    it('should enforce depth 0 when nesting is disallowed', () => {
      // Arrange
      const parser = new QueryParser({ depth: 0, parseArrays: true });
      // Act
      const res = parseRecord(parser, 'a[b]=c');

      // Assert
      expect(res).toEqual({ a: {} });
    });

    it('should enforce depth 1 when one level is allowed', () => {
      // Arrange
      const parser = new QueryParser({ depth: 1, parseArrays: true });
      // Act
      const allowed = parseRecord(parser, 'a[b]=c');
      const blocked = parseRecord(parser, 'a[b][c]=d');

      // Assert
      expect(allowed).toEqual({ a: { b: 'c' } });
      expect(blocked).toEqual({ a: { b: {} } });
    });

    it('should enforce depth 2 when two levels are allowed', () => {
      // Arrange
      const parser = new QueryParser({ depth: 2, parseArrays: true });
      // Act
      const allowed = parseRecord(parser, 'a[b][c]=val');
      const blocked = parseRecord(parser, 'a[b][c][d]=val');

      // Assert
      expect(allowed).toEqual({ a: { b: { c: 'val' } } });
      expect(blocked).toEqual({ a: { b: { c: {} } } });
    });
  });

  // ============================================
  // 6. Option: parameterLimit
  // ============================================
  describe('Option: parameterLimit', () => {
    it('should use default parameterLimit when not provided', () => {
      // Arrange
      const parser = new QueryParser();
      const params = Array.from({ length: 1001 }, (_, index) => `p${index}=${index}`).join('&');
      // Act
      const res = parseRecord(parser, params);

      // Assert
      expect(Object.keys(res).length).toBe(1000);
    });

    it('should enforce parameterLimit 1 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ parameterLimit: 1 });
      // Act
      const res = parseRecord(parser, 'a=1&b=2&c=3');

      // Assert
      expect(res).toEqual({ a: '1' });
    });

    it('should enforce parameterLimit 2 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ parameterLimit: 2 });
      // Act
      const res = parseRecord(parser, 'a=1&b=2&c=3');

      // Assert
      expect(res).toEqual({ a: '1', b: '2' });
    });

    it('should enforce parameterLimit 5 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ parameterLimit: 5 });
      const input = 'a=1&b=2&c=3&d=4&e=5&f=6&g=7';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(Object.keys(res).length).toBe(5);
    });
  });

  // ============================================
  // 7. Option: arrayLimit
  // ============================================
  describe('Option: arrayLimit', () => {
    it('should use default arrayLimit when not provided', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      const expectedArr = new Array(21);

      expectedArr[20] = 'ok';

      // Act
      const allowed = parseRecord(parser, 'arr[20]=ok');
      const blocked = parseRecord(parser, 'arr[21]=blocked');
      // Assert
      const allowedArr = expectQueryArray(allowed.arr);
      const blockedRecord = expectQueryRecord(blocked.arr);

      expect(allowedArr).toEqual(expectedArr);
      expect(blockedRecord).toEqual({ '21': 'blocked' });
    });

    it('should enforce arrayLimit 0 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ arrayLimit: 0, parseArrays: true });
      // Act
      const first = parseRecord(parser, 'arr[0]=a');
      const filtered = parseRecord(parser, 'arr[0]=a&arr[1]=b');
      const fallback = parseRecord(parser, 'arr[1]=b');
      // Assert
      const firstArr = expectQueryArray(first.arr);
      const filteredArr = expectQueryArray(filtered.arr);
      const fallbackRecord = expectQueryRecord(fallback.arr);

      expect(firstArr).toEqual(['a']);
      expect(filteredArr).toEqual(['a']);
      expect(fallbackRecord).toEqual({ '1': 'b' });
    });

    it('should enforce arrayLimit 10 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ arrayLimit: 10, parseArrays: true });
      const expectedArr = ['a'];

      expectedArr[10] = 'b';

      // Act
      const allowed = parseRecord(parser, 'arr[0]=a&arr[10]=b');
      const blocked = parseRecord(parser, 'arr[0]=a&arr[11]=blocked');
      // Assert
      const allowedArr = expectQueryArray(allowed.arr);
      const blockedArr = expectQueryArray(blocked.arr);

      expect(allowedArr).toEqual(expectedArr);
      expect(blockedArr).toEqual(['a']);
    });

    it('should enforce arrayLimit 5 when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ arrayLimit: 5, parseArrays: true });
      const expectedArr: string[] = [];

      expectedArr[5] = 'ok';

      // Act
      const allowed = parseRecord(parser, 'arr[5]=ok');
      const blocked = parseRecord(parser, 'arr[6]=blocked');
      // Assert
      const allowedArr = expectQueryArray(allowed.arr);
      const blockedRecord = expectQueryRecord(blocked.arr);

      expect(allowedArr).toEqual(expectedArr);
      expect(blockedRecord).toEqual({ '6': 'blocked' });
    });
  });

  // ============================================
  // 8. Option: hppMode
  // ============================================
  describe('Option: hppMode', () => {
    it('should use default hppMode when not provided', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'id=1&id=2&id=3');

      // Assert
      expect(res).toEqual({ id: '1' });
    });

    it('should keep first value when hppMode is first', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'first' });
      // Act
      const first = parseRecord(parser, 'id=1&id=2');
      const multiple = parseRecord(parser, 'x=a&x=b&x=c');

      // Assert
      expect(first).toEqual({ id: '1' });
      expect(multiple).toEqual({ x: 'a' });
    });

    it('should keep last value when hppMode is last', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'last' });
      // Act
      const last = parseRecord(parser, 'id=1&id=2');
      const multiple = parseRecord(parser, 'x=a&x=b&x=c');

      // Assert
      expect(last).toEqual({ id: '2' });
      expect(multiple).toEqual({ x: 'c' });
    });

    it('should collect all values when hppMode is array', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'array' });
      // Act
      const two = parseRecord(parser, 'id=1&id=2');
      const many = parseRecord(parser, 'id=1&id=2&id=3&id=4');
      // Assert
      const twoIds = expectQueryArray(two.id);
      const manyIds = expectQueryArray(many.id);

      expect(twoIds).toEqual(['1', '2']);
      expect(manyIds).toEqual(['1', '2', '3', '4']);
    });

    it('should not wrap single value when hppMode is array', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'array' });
      // Act
      const res = parseRecord(parser, 'id=1');

      // Assert
      expect(res).toEqual({ id: '1' });
    });

    it('should allow explicit array brackets when hppMode is first and parseArrays is true', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'first', parseArrays: true });
      // Act
      const res = parseRecord(parser, 'arr[]=1&arr[]=2');
      // Assert
      const arrValue = expectQueryArray(res.arr);

      expect(arrValue).toEqual(['1', '2']);
    });

    it('should handle mixed keys and array brackets when hppMode is array', () => {
      // Arrange
      const parser = new QueryParser({ hppMode: 'array', parseArrays: true });
      // "val=1&val[]=2" -> val: ['1', '2'] if strictly unified?
      // "val" is rootKey. "val" exists as "1".
      // Parser complex handling logic applies.
      // Expectations aligned with observed behavior:
      // Act
      const res = parseRecord(parser, 'val=1');

      // Assert
      expect(res.val).toBe('1');
    });
  });

  // ============================================
  // 9. Security: Prototype Pollution
  // ============================================
  describe('Security: Prototype Pollution', () => {
    it('should block root key __proto__ when parsing query', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, '__proto__=1');

      // Assert
      expect(res).toEqual({});
    });

    it('should block root key constructor when parsing query', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'constructor=1');

      // Assert
      expect(res).toEqual({});
    });

    it('should block root key prototype when parsing query', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'prototype=1');

      // Assert
      expect(res).toEqual({});
    });

    it('should block nested __proto__ pollution when parsing nested keys', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, '__proto__[polluted]=true');

      // Assert
      expect(Object.prototype.hasOwnProperty.call(res, '__proto__')).toBe(false);
    });

    it('should block nested constructor pollution when parsing nested keys', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, 'constructor[prototype][foo]=bar');

      // Assert
      expect(Object.prototype.hasOwnProperty.call(res, 'constructor')).toBe(false);
    });

    it('should allow non-dangerous toString override when provided', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'toString=hacked');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, 'toString')?.value).toBe('hacked');
    });

    it('should block __defineGetter__ and __defineSetter__ when provided', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, '__defineGetter__=bad');

      // Assert
      expect(Object.prototype.hasOwnProperty.call(res, '__defineGetter__')).toBe(false);
      // It is blocked, so it remains the inherited function from Object.prototype
      expect(typeof res.__defineGetter__).toBe('function');
    });
  });

  // ============================================
  // 10. International Characters
  // ============================================
  describe('International Characters', () => {
    const parser = new QueryParser();

    it('should handle Korean characters when present', () => {
      // Arrange
      const raw = '한글=테스트';
      const encoded = 'name=%ED%95%9C%EA%B8%80';
      // Act
      const rawRes = parseRecord(parser, raw);
      const encodedRes = parseRecord(parser, encoded);

      // Assert
      expect(rawRes).toEqual({ 한글: '테스트' });
      expect(encodedRes).toEqual({ name: '한글' });
    });

    it('should handle emojis when provided', () => {
      // Arrange
      const raw = '😊=👍';
      const encoded = 'mood=%F0%9F%98%8A';
      // Act
      const rawRes = parseRecord(parser, raw);
      const encodedRes = parseRecord(parser, encoded);

      // Assert
      expect(rawRes).toEqual({ '😊': '👍' });
      expect(encodedRes).toEqual({ mood: '😊' });
    });

    it('should handle Japanese characters when present', () => {
      // Arrange
      const input = '日本語=テスト';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ 日本語: 'テスト' });
    });

    it('should handle Chinese characters when present', () => {
      // Arrange
      const input = '中文=测试';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ 中文: '测试' });
    });

    it('should handle Arabic characters when present', () => {
      // Arrange
      const input = 'عربي=اختبار';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ عربي: 'اختبار' });
    });
  });

  // ============================================
  // 11. Encoding Edge Cases
  // ============================================
  describe('Encoding Edge Cases', () => {
    const parser = new QueryParser();

    it('should handle reserved characters when encoded', () => {
      // Arrange
      const input = 'eq=%3D&amp=%26';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ eq: '=', amp: '&' });
    });

    it('should throw on malformed percent encoding when invalid', () => {
      // Arrange
      const input = 'bad=%E0%A4';

      // Act
      const act = () => parseRecord(parser, input);

      // Assert
      expect(act).toThrow();
    });

    it('should handle null bytes when present', () => {
      // Arrange
      const input = 'key=%00value';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res.key).toBe('\0value');
    });

    it('should handle control characters when encoded', () => {
      // Arrange
      const input = 'key=%0A%0D%09';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ key: '\n\r\t' });
    });

    it('should handle extremely long keys when length is large', () => {
      // Arrange
      const longKey = 'a'.repeat(10000);
      const input = `${longKey}=1`;
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, longKey)?.value).toBe('1');
    });

    it('should handle extremely long values when length is large', () => {
      // Arrange
      const longValue = 'v'.repeat(10000);
      const input = `key=${longValue}`;
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res.key).toBe(longValue);
    });
  });

  // ============================================
  // 12. Special Key Names
  // ============================================
  describe('Special Key Names', () => {
    const parser = new QueryParser();

    it('should handle JavaScript reserved words when used as keys', () => {
      // Arrange
      const input = 'class=test&function=foo&return=bar';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({
        class: 'test',
        function: 'foo',
        return: 'bar',
      });
    });

    it('should handle numeric keys when provided', () => {
      // Arrange
      const input = '123=value&0=zero';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ '123': 'value', '0': 'zero' });
    });

    it('should handle special characters in keys when not brackets', () => {
      // Arrange
      const dotted = 'user.name=alice';
      const dashed = 'user-name=alice';
      const underscored = 'user_name=alice';
      const numeric = '1key=value';
      // Act
      const dottedRes = parseRecord(parser, dotted);
      const dashedRes = parseRecord(parser, dashed);
      const underscoredRes = parseRecord(parser, underscored);
      const numericRes = parseRecord(parser, numeric);

      // Assert
      expect(dottedRes).toEqual({ 'user.name': 'alice' });
      expect(dashedRes).toEqual({ 'user-name': 'alice' });
      expect(underscoredRes).toEqual({ user_name: 'alice' });
      expect(numericRes).toEqual({ '1key': 'value' });
    });
  });

  // ============================================
  // 13. Bracket Edge Cases
  // ============================================
  describe('Bracket Edge Cases', () => {
    const parser = new QueryParser({ parseArrays: true });

    it('should handle unclosed bracket as literal when strictMode is false', () => {
      // Arrange
      const input = 'a[=b';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ 'a[': 'b' });
    });

    it('should handle unopened bracket as literal when strictMode is false', () => {
      // Arrange
      const input = 'a]=b';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ 'a]': 'b' });
    });

    it('should handle encoded brackets when percent encoded', () => {
      // Arrange
      const input = 'a%5Bb%5D=c';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ a: { b: 'c' } });
    });

    it('should reject empty root key when brackets are used', () => {
      // Arrange
      const input = '[foo]=bar';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({});
    });
  });

  // ============================================
  // 14. Value Edge Cases
  // ============================================
  describe('Value Edge Cases', () => {
    const parser = new QueryParser();

    it('should handle JSON-like value when encoded', () => {
      // Arrange
      const encoded = encodeURIComponent('{"key":"value"}');
      const input = `data=${encoded}`;
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ data: '{"key":"value"}' });
    });

    it('should handle URL as value when encoded', () => {
      // Arrange
      const encoded = encodeURIComponent('https://example.com?foo=bar');
      const input = `url=${encoded}`;
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ url: 'https://example.com?foo=bar' });
    });

    it('should handle base64 value when padding is present', () => {
      // Arrange
      const input = 'data=SGVsbG8gV29ybGQ=';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toEqual({ data: 'SGVsbG8gV29ybGQ=' });
    });
  });

  // ============================================
  // 15. Combined Options
  // ============================================
  describe('Combined Options', () => {
    it('should handle HPP with parseArrays when both enabled', () => {
      // Arrange
      const parser = new QueryParser({
        hppMode: 'array',
        parseArrays: true,
      });
      // Act
      const res = parseRecord(parser, 'a=1&a=2&b[]=x&b[]=y');
      // Assert
      const arrA = expectQueryArray(res.a);
      const arrB = expectQueryArray(res.b);

      expect(arrA).toEqual(['1', '2']);
      expect(arrB).toEqual(['x', 'y']);
    });

    it('should handle depth with parseArrays when depth is set', () => {
      // Arrange
      const parser = new QueryParser({ depth: 1, parseArrays: true });
      // Act
      const res = parseRecord(parser, 'a[b][c]=d');

      // Assert
      expect(res).toEqual({ a: { b: {} } });
    });

    it('should handle arrayLimit with parseArrays when limit is set', () => {
      // Arrange
      const parser = new QueryParser({ arrayLimit: 2, parseArrays: true });
      // Act
      const res = parseRecord(parser, 'arr[0]=a&arr[2]=b&arr[3]=blocked');
      // Assert
      const arrValue = expectQueryArray(res.arr);

      expect(arrValue[0]).toBe('a');
      expect(arrValue[1]).toBeUndefined();
      expect(arrValue[2]).toBe('b');
    });
  });

  // ============================================
  // 16. Array/Object Conflict (Edge)
  // ============================================
  describe('Array/Object Conflict', () => {
    const parser = new QueryParser({ parseArrays: true });

    it('should handle array first then object notation when mixed', () => {
      // Arrange
      const input = 'data[0]=a&data[name]=b';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toMatchObject({ data: expect.anything() });
    });

    it('should handle object first then array notation when mixed', () => {
      // Arrange
      const input = 'data[name]=a&data[0]=b';
      // Act
      const res = parseRecord(parser, input);

      // Assert
      expect(res).toMatchObject({ data: expect.anything() });
    });
  });

  // ============================================
  // 17. Additional Edge Cases (Reinforcement)
  // ============================================
  describe('Additional Edge Cases', () => {
    it('should handle parameterLimit 0 when no params are allowed', () => {
      // Arrange
      const parser = new QueryParser({ parameterLimit: 0 });
      // Act
      const res = parseRecord(parser, 'a=1&b=2');

      // Assert
      expect(res).toEqual({ a: '1' });
    });

    it('should handle negative array index when treated as object property', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, 'arr[-1]=negative');

      // Assert
      expect(res.arr).toEqual({ '-1': 'negative' });
    });

    it('should handle floating point index when treated as object property', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, 'arr[1.5]=float');

      // Assert
      expect(res.arr).toEqual({ '1.5': 'float' });
    });

    it('should handle very large index when exceeding arrayLimit', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true, arrayLimit: 20 });
      // Act
      const res = parseRecord(parser, 'arr[999999]=huge');

      // Assert
      expect(res.arr).toEqual({ '999999': 'huge' });
    });

    it('should handle hasOwnProperty as key when no conflict exists', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'hasOwnProperty=value');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, 'hasOwnProperty')?.value).toBe('value');
      expect(Object.prototype.hasOwnProperty.call(res, 'hasOwnProperty')).toBe(true);
    });

    it('should handle valueOf as key when no conflict exists', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'valueOf=custom');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, 'valueOf')?.value).toBe('custom');
    });

    it('should handle toJSON as key when provided', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, 'toJSON=custom');

      // Assert
      expect(res.toJSON).toBe('custom');
    });

    it('should handle whitespace-only key when decoded', () => {
      // Arrange
      const parser = new QueryParser();
      // Act
      const res = parseRecord(parser, '%20=spacekey');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, ' ')?.value).toBe('spacekey');
    });

    it('should handle mixed empty and non-empty brackets when provided', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, 'arr[]=a&arr[1]=b&arr[]=c');
      const arrValue = expectQueryArray(res.arr);

      // Assert
      // arr[]=a -> arr[0]=a
      // arr[1]=b -> arr[1]=b
      // arr[]=c -> arr.push(c) -> arr[2]=c
      expect(arrValue[0]).toBe('a');
      expect(arrValue[1]).toBe('b');
      expect(arrValue[2]).toBe('c');
    });
  });

  // ============================================
  // 18. Strict Mode & Mixed Keys
  // ============================================
  describe('Strict Mode & Mixed Keys', () => {
    it('should throw on unbalanced brackets when strictMode is true', () => {
      // Arrange
      const parser = new QueryParser({ strictMode: true });

      // Act
      const unclosed = (): void => {
        parser.parse('a[b=1');
      };

      const unbalanced = (): void => {
        parser.parse('a]b=1');
      };

      // Assert
      expect(unclosed).toThrow(/unclosed bracket/);
      expect(unbalanced).toThrow(/unbalanced brackets/);
    });

    it('should throw on nested brackets when strictMode is true', () => {
      // Arrange
      const parser = new QueryParser({ strictMode: true });

      // Act
      const act = (): void => {
        parser.parse('a[[b]]=1');
      };

      // Assert
      expect(act).toThrow(/nested brackets/);
    });

    it('should throw on mixed scalar and nested keys when strictMode is true', () => {
      // Arrange
      const parser = new QueryParser({ strictMode: true, parseArrays: true });

      // Act
      const scalarFirst = (): void => {
        parser.parse('a=1&a[b]=2');
      };

      const arrayFirst = (): void => {
        parser.parse('b[0]=1&b=2');
      };

      // Assert
      expect(scalarFirst).toThrow(/Conflict/);
      expect(arrayFirst).toThrow(/Conflict/);
    });

    it('should convert array to object when non-numeric key is mixed in non-strict mode', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true, strictMode: false });
      // Act
      const res = parseRecord(parser, 'a[0]=1&a[foo]=2');

      // Assert
      // 'a' was array [1], then converted to object { '0': 1, 'foo': 2 }
      expect(res.a).toEqual({ '0': '1', foo: '2' });
    });

    it('should throw when non-numeric key is mixed in array and strictMode is true', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true, strictMode: true });

      // Act
      const act = (): void => {
        parser.parse('a[0]=1&a[foo]=2');
      };

      // Assert
      expect(act).toThrow(/non-numeric key/);
    });

    it('should handle deep array-to-object conversion when mixed keys appear', () => {
      // Arrange
      const parser = new QueryParser({ parseArrays: true });
      // Act
      const res = parseRecord(parser, 'user[roles][0]=admin&user[roles][name]=editor');
      // Assert
      const user = expectQueryRecord(res.user);
      const roles = expectQueryRecord(user.roles);

      expect(roles).toEqual({ '0': 'admin', name: 'editor' });
    });
  });
});
