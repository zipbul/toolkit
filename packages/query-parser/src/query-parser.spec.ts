/* oxlint-disable typescript-eslint/no-unsafe-type-assertion */

import { describe, expect, it } from 'bun:test';

import { QueryParserErrorReason } from './enums';
import { QueryParserError } from './interfaces';
import type { QueryParserOptions } from './interfaces';
import type { QueryArray, QueryValue, QueryValueRecord } from './types';

import { QueryParser } from './query-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const catchError = (fn: () => void): QueryParserError => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof QueryParserError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected QueryParserError to be thrown');
};

// ---------------------------------------------------------------------------
// QueryParser
// ---------------------------------------------------------------------------
describe('QueryParser', () => {
  // =========================================================================
  // create
  // =========================================================================
  describe('create', () => {
    it('should return a QueryParser instance when called with no arguments', () => {
      // Act
      const parser = QueryParser.create();

      // Assert
      expect(parser).toBeInstanceOf(QueryParser);
    });

    it('should return a QueryParser instance when called with valid partial options', () => {
      // Act
      const parser = QueryParser.create({ nesting: true, depth: 3 });

      // Assert
      expect(parser).toBeInstanceOf(QueryParser);
    });

    it('should throw QueryParserError when depth is invalid', () => {
      // Act
      const error = catchError(() => QueryParser.create({ depth: -1 }));

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidDepth);
    });

    it('should throw QueryParserError when maxParams is invalid', () => {
      // Act
      const error = catchError(() => QueryParser.create({ maxParams: 0 }));

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidMaxParams);
    });

    it('should throw QueryParserError when duplicates is invalid', () => {
      // Act
      const error = catchError(() =>
        QueryParser.create({ duplicates: 'invalid' } as unknown as QueryParserOptions),
      );

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidDuplicates);
    });
  });

  // =========================================================================
  // Core RFC3986 Compliance
  // =========================================================================
  describe('core RFC3986 compliance', () => {
    const parser = QueryParser.create();

    it('should parse simple key=value pairs when query has pairs', () => {
      // Act & Assert
      expect(parser.parse('foo=bar')).toEqual({ foo: 'bar' });
      expect(parser.parse('foo=bar&baz=qux')).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('should parse percent-encoded keys and values when input is encoded', () => {
      // Act & Assert
      expect(parser.parse('a%20b=c%20d')).toEqual({ 'a b': 'c d' });
      expect(parser.parse('foo=%26%3D')).toEqual({ foo: '&=' });
      expect(parser.parse('path=%2fhome')).toEqual({ path: '/home' });
      expect(parser.parse('path=%2Fhome')).toEqual({ path: '/home' });
    });

    it('should parse empty values when key has no value', () => {
      // Act & Assert
      expect(parser.parse('foo=&bar=')).toEqual({ foo: '', bar: '' });
    });

    it('should parse keys without values when flags are used', () => {
      // Act & Assert
      expect(parser.parse('foo&bar')).toEqual({ foo: '', bar: '' });
    });

    it('should ignore leading question mark when query starts with ?', () => {
      // Act & Assert
      expect(parser.parse('?foo=bar')).toEqual({ foo: 'bar' });
      expect(parser.parse('??foo=bar')).toEqual({ '?foo': 'bar' });
    });

    it('should treat plus sign as literal when strict RFC 3986 applies', () => {
      // Act & Assert
      expect(parser.parse('hello+world=test')).toEqual({ 'hello+world': 'test' });
    });

    it('should not double-decode values when percent encoded twice', () => {
      // Act & Assert
      expect(parser.parse('key=%2520')).toEqual({ key: '%20' });
    });

    it('should handle multiple equals signs when value includes =', () => {
      // Act & Assert
      expect(parser.parse('a=b=c')).toEqual({ a: 'b=c' });
      expect(parser.parse('a==b')).toEqual({ a: '=b' });
    });
  });

  // =========================================================================
  // Empty Input & Boundary Conditions
  // =========================================================================
  describe('empty input and boundary conditions', () => {
    const parser = QueryParser.create();

    it('should return empty object when input is empty string', () => {
      // Act & Assert
      expect(parser.parse('')).toEqual({});
    });

    it('should return empty object when only question mark is provided', () => {
      // Act & Assert
      expect(parser.parse('?')).toEqual({});
    });

    it('should return empty object when only delimiters are provided', () => {
      // Act & Assert
      expect(parser.parse('&')).toEqual({});
      expect(parser.parse('&&&&')).toEqual({});
      expect(parser.parse('=')).toEqual({});
      expect(parser.parse('=&=&=')).toEqual({});
    });

    it('should ignore empty keys when key is missing', () => {
      // Act & Assert
      expect(parser.parse('=value')).toEqual({});
      expect(parser.parse('=value&foo=bar')).toEqual({ foo: 'bar' });
    });

    it('should handle extra ampersands when delimiters repeat', () => {
      // Act & Assert
      expect(parser.parse('a=1&&b=2')).toEqual({ a: '1', b: '2' });
      expect(parser.parse('a=1&')).toEqual({ a: '1' });
      expect(parser.parse('&a=1')).toEqual({ a: '1' });
      expect(parser.parse('a=1&&&&&b=2')).toEqual({ a: '1', b: '2' });
    });
  });

  // =========================================================================
  // nesting enabled
  // =========================================================================
  describe('nesting enabled', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should parse nested object when brackets are used', () => {
      // Act & Assert
      expect(parser.parse('user[name]=alice')).toEqual({ user: { name: 'alice' } });
      expect(parser.parse('user[name]=alice&user[age]=20')).toEqual({
        user: { name: 'alice', age: '20' },
      });
    });

    it('should parse array with explicit indices when indexed brackets provided', () => {
      // Act
      const res = parser.parse('arr[0]=a&arr[1]=b');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['a', 'b']);
    });

    it('should parse array with empty brackets when push-style syntax used', () => {
      // Act
      const res = parser.parse('arr[]=a&arr[]=b');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['a', 'b']);
    });

    it('should parse mixed array in object when nested arrays appear', () => {
      // Act & Assert
      expect(parser.parse('user[phones][0]=123&user[phones][1]=456')).toEqual({
        user: { phones: ['123', '456'] },
      });
    });

    it('should parse object in array when nested objects appear', () => {
      // Act & Assert
      expect(parser.parse('users[0][name]=alice&users[1][name]=bob')).toEqual({
        users: [{ name: 'alice' }, { name: 'bob' }],
      });
    });

    it('should parse deeply nested structures when depth allows', () => {
      // Act & Assert
      expect(parser.parse('a[b][c][d][e]=deep')).toEqual({
        a: { b: { c: { d: { e: 'deep' } } } },
      });
    });

    it('should parse sparse arrays when indices skip positions', () => {
      // Act
      const res = parser.parse('arr[0]=a&arr[5]=b');
      const arr = expectQueryArray(res.arr);

      // Assert
      expect(arr[0]).toBe('a');
      expect(arr[5]).toBe('b');
    });

    it('should parse non-sequential indices when order differs', () => {
      // Act
      const res = parser.parse('arr[2]=c&arr[0]=a');
      const arr = expectQueryArray(res.arr);

      // Assert
      expect(arr[0]).toBe('a');
      expect(arr[2]).toBe('c');
    });

    it('should parse mixed bracket types when array contains object', () => {
      // Act & Assert
      expect(parser.parse('a[0][name]=alice')).toEqual({ a: [{ name: 'alice' }] });
    });
  });

  // =========================================================================
  // nesting disabled (default)
  // =========================================================================
  describe('nesting disabled', () => {
    const parser = QueryParser.create({ nesting: false });

    it('should treat brackets as literal key characters when nesting is false', () => {
      // Act & Assert
      expect(parser.parse('user[name]=alice')).toEqual({ 'user[name]': 'alice' });
      expect(parser.parse('arr[0]=a')).toEqual({ 'arr[0]': 'a' });
      expect(parser.parse('arr[]=a')).toEqual({ 'arr[]': 'a' });
      expect(parser.parse('a[b][c]=d')).toEqual({ 'a[b][c]': 'd' });
    });
  });

  // =========================================================================
  // depth
  // =========================================================================
  describe('depth', () => {
    it('should use default depth when no depth is provided', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[b][c][d][e][f]=deep')).toEqual({
        a: { b: { c: { d: { e: { f: 'deep' } } } } },
      });
      expect(parser.parse('a[b][c][d][e][f][g]=blocked')).toEqual({
        a: { b: { c: { d: { e: { f: {} } } } } },
      });
    });

    it('should enforce depth 0 when nesting is disallowed', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 0, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b]=c')).toEqual({ a: {} });
    });

    it('should enforce depth 1 when one level is allowed', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 1, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b]=c')).toEqual({ a: { b: 'c' } });
      expect(parser.parse('a[b][c]=d')).toEqual({ a: { b: {} } });
    });
  });

  // =========================================================================
  // maxParams
  // =========================================================================
  describe('maxParams', () => {
    it('should use default maxParams when not provided', () => {
      // Arrange
      const parser = QueryParser.create();
      const params = Array.from({ length: 1001 }, (_, i) => `p${i}=${i}`).join('&');

      // Act
      const res = parser.parse(params);

      // Assert
      expect(Object.keys(res).length).toBe(1000);
    });

    it('should enforce maxParams 1 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 1 });

      // Act & Assert
      expect(parser.parse('a=1&b=2&c=3')).toEqual({ a: '1' });
    });

    it('should enforce maxParams 2 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&b=2&c=3')).toEqual({ a: '1', b: '2' });
    });
  });

  // =========================================================================
  // arrayLimit
  // =========================================================================
  describe('arrayLimit', () => {
    it('should use default arrayLimit when not provided', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });
      const expectedArr = new Array(21);

      expectedArr[20] = 'ok';

      // Act
      const allowed = parser.parse('arr[20]=ok');
      const blocked = parser.parse('arr[21]=blocked');

      // Assert
      expect(expectQueryArray(allowed.arr)).toEqual(expectedArr);
      expect(expectQueryRecord(blocked.arr)).toEqual({ '21': 'blocked' });
    });

    it('should enforce arrayLimit 0 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ arrayLimit: 0, nesting: true });

      // Act
      const first = parser.parse('arr[0]=a');
      const filtered = parser.parse('arr[0]=a&arr[1]=b');
      const fallback = parser.parse('arr[1]=b');

      // Assert
      expect(expectQueryArray(first.arr)).toEqual(['a']);
      expect(expectQueryArray(filtered.arr)).toEqual(['a']);
      expect(expectQueryRecord(fallback.arr)).toEqual({ '1': 'b' });
    });

    it('should enforce arrayLimit 10 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ arrayLimit: 10, nesting: true });
      const expectedArr = ['a'];

      expectedArr[10] = 'b';

      // Act
      const allowed = parser.parse('arr[0]=a&arr[10]=b');
      const blocked = parser.parse('arr[0]=a&arr[11]=blocked');

      // Assert
      expect(expectQueryArray(allowed.arr)).toEqual(expectedArr);
      expect(expectQueryArray(blocked.arr)).toEqual(['a']);
    });
  });

  // =========================================================================
  // duplicates
  // =========================================================================
  describe('duplicates', () => {
    it('should keep first value when duplicates is first', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'first' });

      // Act & Assert
      expect(parser.parse('id=1&id=2')).toEqual({ id: '1' });
      expect(parser.parse('x=a&x=b&x=c')).toEqual({ x: 'a' });
    });

    it('should keep last value when duplicates is last', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'last' });

      // Act & Assert
      expect(parser.parse('id=1&id=2')).toEqual({ id: '2' });
      expect(parser.parse('x=a&x=b&x=c')).toEqual({ x: 'c' });
    });

    it('should collect all values when duplicates is array', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array' });

      // Act
      const two = parser.parse('id=1&id=2');
      const many = parser.parse('id=1&id=2&id=3&id=4');

      // Assert
      expect(expectQueryArray(two.id)).toEqual(['1', '2']);
      expect(expectQueryArray(many.id)).toEqual(['1', '2', '3', '4']);
    });

    it('should not wrap single value when duplicates is array', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array' });

      // Act & Assert
      expect(parser.parse('id=1')).toEqual({ id: '1' });
    });

    it('should allow explicit array brackets when duplicates is first and nesting is true', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'first', nesting: true });

      // Act
      const res = parser.parse('arr[]=1&arr[]=2');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['1', '2']);
    });
  });

  // =========================================================================
  // Security: Prototype Pollution
  // =========================================================================
  describe('security: prototype pollution', () => {
    it('should block POISONED root keys when parsing query', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert
      expect(parser.parse('__proto__=1')).toEqual({});
      expect(parser.parse('constructor=1')).toEqual({});
      expect(parser.parse('prototype=1')).toEqual({});
    });

    it('should block __defineGetter__ and __defineSetter__ when provided', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const res = parser.parse('__defineGetter__=bad');

      // Assert
      expect(Object.prototype.hasOwnProperty.call(res, '__defineGetter__')).toBe(false);
    });

    it('should block __lookupGetter__ and __lookupSetter__ when provided', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const lookupGetter = parser.parse('__lookupGetter__=bad');
      const lookupSetter = parser.parse('__lookupSetter__=bad');

      // Assert
      expect(Object.prototype.hasOwnProperty.call(lookupGetter, '__lookupGetter__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lookupSetter, '__lookupSetter__')).toBe(false);
    });

    it('should block nested POISONED keys when parsing nested structures', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      const protoRes = parser.parse('__proto__[polluted]=true');

      expect(Object.prototype.hasOwnProperty.call(protoRes, '__proto__')).toBe(false);

      const ctorRes = parser.parse('constructor[prototype][foo]=bar');

      expect(Object.prototype.hasOwnProperty.call(ctorRes, 'constructor')).toBe(false);
    });

    it('should block POISONED keys at child positions when nesting is true', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const protoChild = parser.parse('safe[__proto__]=polluted');
      const ctorChild = parser.parse('safe[constructor]=polluted');
      const prototypeChild = parser.parse('safe[prototype]=polluted');

      // Assert — child poisoned keys are silently dropped
      const safeProto = expectQueryRecord(protoChild.safe);

      expect(Object.prototype.hasOwnProperty.call(safeProto, '__proto__')).toBe(false);

      const safeCtor = expectQueryRecord(ctorChild.safe);

      expect(Object.prototype.hasOwnProperty.call(safeCtor, 'constructor')).toBe(false);

      const safePrototype = expectQueryRecord(prototypeChild.safe);

      expect(Object.prototype.hasOwnProperty.call(safePrototype, 'prototype')).toBe(false);
    });

    it('should allow non-dangerous inherited method names when used as keys', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert
      expect(Object.getOwnPropertyDescriptor(parser.parse('toString=hacked'), 'toString')?.value).toBe('hacked');
      expect(Object.getOwnPropertyDescriptor(parser.parse('hasOwnProperty=value'), 'hasOwnProperty')?.value).toBe('value');
      expect(Object.getOwnPropertyDescriptor(parser.parse('valueOf=custom'), 'valueOf')?.value).toBe('custom');
    });
  });

  // =========================================================================
  // International Characters
  // =========================================================================
  describe('international characters', () => {
    const parser = QueryParser.create();

    it('should handle Korean characters when present', () => {
      // Act & Assert
      expect(parser.parse('한글=테스트')).toEqual({ 한글: '테스트' });
      expect(parser.parse('name=%ED%95%9C%EA%B8%80')).toEqual({ name: '한글' });
    });

    it('should handle emoji characters when provided', () => {
      // Act & Assert
      expect(parser.parse('😊=👍')).toEqual({ '😊': '👍' });
      expect(parser.parse('mood=%F0%9F%98%8A')).toEqual({ mood: '😊' });
    });
  });

  // =========================================================================
  // Encoding Edge Cases
  // =========================================================================
  describe('encoding edge cases', () => {
    const parser = QueryParser.create();

    it('should handle reserved characters when encoded', () => {
      // Act & Assert
      expect(parser.parse('eq=%3D&amp=%26')).toEqual({ eq: '=', amp: '&' });
    });

    it('should return raw string for malformed percent encoding in value when non-strict', () => {
      // Act & Assert — non-strict falls back to raw string
      expect(parser.parse('bad=%E0%A4')).toEqual({ bad: '%E0%A4' });
      expect(parser.parse('key=%zz')).toEqual({ key: '%zz' });
    });

    it('should return raw string for malformed percent encoding in key when non-strict', () => {
      // Act & Assert — non-strict falls back to raw key string
      expect(parser.parse('%E0%A4=value')).toEqual({ '%E0%A4': 'value' });
    });

    it('should throw QueryParserError for malformed percent encoding in value when strict', () => {
      // Arrange
      const strictParser = QueryParser.create({ strict: true });

      // Act & Assert
      const error = catchError(() => strictParser.parse('bad=%E0%A4'));

      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.MalformedQueryString);
    });

    it('should throw QueryParserError for malformed percent encoding in key when strict', () => {
      // Arrange
      const strictParser = QueryParser.create({ strict: true });

      // Act & Assert
      const error = catchError(() => strictParser.parse('%E0%A4=value'));

      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.MalformedQueryString);
    });

    it('should handle null bytes when present', () => {
      // Act & Assert
      expect(parser.parse('key=%00value').key).toBe('\0value');
    });

    it('should handle control characters when encoded', () => {
      // Act & Assert
      expect(parser.parse('key=%0A%0D%09')).toEqual({ key: '\n\r\t' });
    });

    it('should handle extremely long keys when length is large', () => {
      // Arrange
      const longKey = 'a'.repeat(10000);

      // Act
      const res = parser.parse(`${longKey}=1`);

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, longKey)?.value).toBe('1');
    });
  });

  // =========================================================================
  // Special Key Names
  // =========================================================================
  describe('special key names', () => {
    const parser = QueryParser.create();

    it('should handle JavaScript reserved words when used as keys', () => {
      // Act & Assert
      expect(parser.parse('class=test&function=foo&return=bar')).toEqual({
        class: 'test',
        function: 'foo',
        return: 'bar',
      });
    });

    it('should handle numeric keys when provided', () => {
      // Act & Assert
      expect(parser.parse('123=value&0=zero')).toEqual({ '123': 'value', '0': 'zero' });
    });

    it('should handle special characters in keys when not brackets', () => {
      // Act & Assert
      expect(parser.parse('user.name=alice')).toEqual({ 'user.name': 'alice' });
      expect(parser.parse('user-name=alice')).toEqual({ 'user-name': 'alice' });
      expect(parser.parse('user_name=alice')).toEqual({ user_name: 'alice' });
    });
  });

  // =========================================================================
  // Bracket Edge Cases
  // =========================================================================
  describe('bracket edge cases', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should handle unclosed bracket as literal when strict is false', () => {
      // Act & Assert
      expect(parser.parse('a[=b')).toEqual({ 'a[': 'b' });
    });

    it('should handle unmatched close bracket as literal when strict is false', () => {
      // Act & Assert
      expect(parser.parse('a]=b')).toEqual({ 'a]': 'b' });
    });

    it('should handle encoded brackets when percent encoded', () => {
      // Act & Assert
      expect(parser.parse('a%5Bb%5D=c')).toEqual({ a: { b: 'c' } });
    });

    it('should reject empty root key when brackets are used', () => {
      // Act & Assert
      expect(parser.parse('[foo]=bar')).toEqual({});
    });
  });

  // =========================================================================
  // Value Edge Cases
  // =========================================================================
  describe('value edge cases', () => {
    const parser = QueryParser.create();

    it('should handle JSON-like value when encoded', () => {
      // Arrange
      const encoded = encodeURIComponent('{"key":"value"}');

      // Act & Assert
      expect(parser.parse(`data=${encoded}`)).toEqual({ data: '{"key":"value"}' });
    });

    it('should handle base64 value when padding is present', () => {
      // Act & Assert
      expect(parser.parse('data=SGVsbG8gV29ybGQ=')).toEqual({ data: 'SGVsbG8gV29ybGQ=' });
    });
  });

  // =========================================================================
  // Combined Options
  // =========================================================================
  describe('combined options', () => {
    it('should handle HPP with nesting when both enabled', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array', nesting: true });

      // Act
      const res = parser.parse('a=1&a=2&b[]=x&b[]=y');

      // Assert
      expect(expectQueryArray(res.a)).toEqual(['1', '2']);
      expect(expectQueryArray(res.b)).toEqual(['x', 'y']);
    });

    it('should handle depth with nesting when depth is set', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 1, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b][c]=d')).toEqual({ a: { b: {} } });
    });

    it('should handle arrayLimit with nesting when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ arrayLimit: 2, nesting: true });

      // Act
      const res = parser.parse('arr[0]=a&arr[2]=b&arr[3]=blocked');
      const arrValue = expectQueryArray(res.arr);

      // Assert
      expect(arrValue[0]).toBe('a');
      expect(arrValue[1]).toBeUndefined();
      expect(arrValue[2]).toBe('b');
    });
  });

  // =========================================================================
  // Array/Object Conflict
  // =========================================================================
  describe('array/object conflict', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should handle array first then object notation when mixed', () => {
      // Act
      const res = parser.parse('data[0]=a&data[name]=b');

      // Assert — array converted to object
      expect(res.data).toEqual({ '0': 'a', name: 'b' });
    });

    it('should handle object first then array notation when mixed', () => {
      // Act
      const res = parser.parse('data[name]=a&data[0]=b');

      // Assert — stays as object
      expect(res.data).toEqual({ name: 'a', '0': 'b' });
    });
  });

  // =========================================================================
  // Additional Edge Cases
  // =========================================================================
  describe('additional edge cases', () => {
    it('should handle negative array index when treated as object property', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('arr[-1]=negative')).toEqual({ arr: { '-1': 'negative' } });
    });

    it('should handle very large index when exceeding arrayLimit', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, arrayLimit: 20 });

      // Act & Assert
      expect(parser.parse('arr[999999]=huge')).toEqual({ arr: { '999999': 'huge' } });
    });

    it('should reject leading zeros in array index when nesting is true', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert — '007' has leading zero → object property, not array index
      expect(parser.parse('arr[007]=val')).toEqual({ arr: { '007': 'val' } });
      expect(parser.parse('arr[01]=val')).toEqual({ arr: { '01': 'val' } });

      // '0' itself is still a valid array index
      expect(expectQueryArray(parser.parse('arr[0]=val').arr)).toEqual(['val']);
    });

    it('should handle mixed empty and indexed brackets when provided', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('arr[]=a&arr[1]=b&arr[]=c');
      const arrValue = expectQueryArray(res.arr);

      // Assert
      expect(arrValue[0]).toBe('a');
      expect(arrValue[1]).toBe('b');
      expect(arrValue[2]).toBe('c');
    });

    it('should handle whitespace-only key when decoded', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const res = parser.parse('%20=spacekey');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, ' ')?.value).toBe('spacekey');
    });
  });

  // =========================================================================
  // Strict Mode
  // =========================================================================
  describe('strict mode', () => {
    it('should throw on unbalanced brackets when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true });

      // Act & Assert
      expect(() => parser.parse('a]b=1')).toThrow(/unbalanced brackets/);
      expect(() => parser.parse('a[b=1')).toThrow(/unclosed bracket/);
    });

    it('should throw on nested brackets when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true });

      // Act & Assert
      expect(() => parser.parse('a[[b]]=1')).toThrow(/nested brackets/);
    });

    it('should throw on mixed scalar and nested keys when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert — scalar first, then bracket key triggers conflict in parseComplexKey
      expect(() => parser.parse('a=1&a[b]=2')).toThrow(/Conflict/);
    });

    it('should throw when non-numeric key is mixed in array and strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, strict: true });

      // Act & Assert
      expect(() => parser.parse('a[0]=1&a[foo]=2')).toThrow(/non-numeric key/);
    });

    it('should convert array to object when non-numeric key is mixed in non-strict mode', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, strict: false });

      // Act
      const res = parser.parse('a[0]=1&a[foo]=2');

      // Assert — array converted to object
      expect(res.a).toEqual({ '0': '1', foo: '2' });
    });

    it('should handle deep array-to-object conversion when mixed keys appear', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('user[roles][0]=admin&user[roles][name]=editor');
      const user = expectQueryRecord(res.user);
      const roles = expectQueryRecord(user.roles);

      // Assert
      expect(roles).toEqual({ '0': 'admin', name: 'editor' });
    });
  });

  // =========================================================================
  // Parser Reuse
  // =========================================================================
  describe('parser reuse', () => {
    it('should produce independent results when parser is reused', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const res1 = parser.parse('a=1');
      const res2 = parser.parse('b=2');
      const res3 = parser.parse('a=1');

      // Assert
      expect(res1).toEqual({ a: '1' });
      expect(res2).toEqual({ b: '2' });
      expect(res3).toEqual({ a: '1' });
    });
  });

  // =========================================================================
  // URL-Encoded (application/x-www-form-urlencoded)
  // =========================================================================
  describe('urlEncoded', () => {
    const parser = QueryParser.create({ urlEncoded: true });

    it('should decode plus sign as space in values when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('name=hello+world')).toEqual({ name: 'hello world' });
      expect(parser.parse('q=foo+bar+baz')).toEqual({ q: 'foo bar baz' });
    });

    it('should decode plus sign as space in keys when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('hello+world=test')).toEqual({ 'hello world': 'test' });
    });

    it('should decode plus sign combined with percent encoding when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('name=hello+world%21')).toEqual({ name: 'hello world!' });
      expect(parser.parse('q=%EC%84%9C%EC%9A%B8+%EC%8B%9C')).toEqual({ q: '서울 시' });
    });

    it('should decode multiple plus signs as multiple spaces when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('q=a++b+++c')).toEqual({ q: 'a  b   c' });
    });

    it('should not decode plus when urlEncoded is false', () => {
      // Arrange
      const defaultParser = QueryParser.create();

      // Act & Assert
      expect(defaultParser.parse('name=hello+world')).toEqual({ name: 'hello+world' });
    });

    it('should handle form-typical payload when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('username=john+doe&password=p%40ss+word&remember=on')).toEqual({
        username: 'john doe',
        password: 'p@ss word',
        remember: 'on',
      });
    });

    it('should handle plus in nested keys when urlEncoded and nesting are true', () => {
      // Arrange
      const nestingParser = QueryParser.create({ urlEncoded: true, nesting: true });

      // Act & Assert
      expect(nestingParser.parse('user[full+name]=alice')).toEqual({ user: { 'full name': 'alice' } });
    });

    it('should handle only-plus values when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('space=+')).toEqual({ space: ' ' });
      expect(parser.parse('spaces=+++')).toEqual({ spaces: '   ' });
    });
  });
});
