import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';

import { POISONED_KEYS } from './constants';
import { QueryParserErrorReason } from './enums';
import { QueryParserError } from './interfaces';
import type { QueryParserErrorData, QueryParserOptions } from './interfaces';
import { resolveQueryParserOptions, validateQueryParserOptions } from './options';
import type { QueryArray, QueryContainer, QueryValue, QueryValueRecord, ResolvedQueryParserOptions } from './types';

/**
 * High-performance, strict query string parser.
 * Implements RFC 3986 compliance with strict security controls.
 */
export class QueryParser {
  private readonly options: ResolvedQueryParserOptions;

  private constructor(options: ResolvedQueryParserOptions) {
    this.options = options;
  }

  /**
   * Creates a QueryParser instance after resolving and validating options.
   *
   * @throws {QueryParserError} when options fail validation.
   * @returns A ready-to-use QueryParser instance.
   */
  public static create(options?: QueryParserOptions): QueryParser {
    const resolved = resolveQueryParserOptions(options);
    const validation = validateQueryParserOptions(resolved);

    if (isErr(validation)) {
      throw new QueryParserError(validation.data);
    }

    return new QueryParser(resolved);
  }

  /**
   * Parses a query string into a key-value record.
   *
   * @throws {QueryParserError} in strict mode when the query string is malformed
   *         or contains conflicting key structures.
   * @returns Parsed query parameters as a record.
   */
  public parse(qs: string): QueryValueRecord {
    const result = this.parseInternal(qs);

    if (isErr(result)) {
      throw new QueryParserError(result.data);
    }

    return result;
  }

  private parseInternal(qs: string): Result<QueryValueRecord, QueryParserErrorData> {
    if (!qs || qs.length === 0) {
      return {};
    }

    const res: QueryValueRecord = {};
    const len = qs.length;
    let i = 0;

    // Ignore leading '?'
    if (qs.charCodeAt(0) === 63) {
      i = 1;
    }

    let keyStart = i;
    let keyEnd = -1;
    let valStart = -1;
    let isKey = true;
    let paramCount = 0;
    let limitReached = false;

    // Fast path: Scan loop
    while (i < len) {
      const code = qs.charCodeAt(i);

      if (code === 61) {
        // '='
        if (isKey) {
          keyEnd = i;
          valStart = i + 1;
          isKey = false;
        }
      } else if (code === 38) {
        // '&'
        if (keyEnd === -1) {
          keyEnd = i;
          valStart = i;
        }

        const pairResult = this.processPair(res, qs, keyStart, keyEnd, valStart, i);

        if (isErr(pairResult)) {
          return pairResult;
        }

        paramCount++;

        if (paramCount >= this.options.parameterLimit) {
          limitReached = true;
          break;
        }

        // Reset
        keyStart = i + 1;
        keyEnd = -1;
        valStart = -1;
        isKey = true;
      }

      i++;
    }

    // Process last pair (only if limit was not reached)
    if (!limitReached && keyStart < len) {
      if (keyEnd === -1) {
        keyEnd = len;
        valStart = len;
      }

      const pairResult = this.processPair(res, qs, keyStart, keyEnd, valStart, len);

      if (isErr(pairResult)) {
        return pairResult;
      }
    }

    return res;
  }

  private processPair(
    res: QueryValueRecord,
    qs: string,
    keyStart: number,
    keyEnd: number,
    valStart: number,
    valEnd: number,
  ): Err<QueryParserErrorData> | undefined {
    // Decode Key
    const keyRaw = qs.slice(keyStart, keyEnd);
    const key = keyRaw.includes('%') ? decodeURIComponent(keyRaw) : keyRaw;

    if (!key) {
      return;
    }

    // Decode Value
    let val = '';

    if (valStart < valEnd) {
      const valRaw = qs.slice(valStart, valEnd);

      val = valRaw.includes('%') ? decodeURIComponent(valRaw) : valRaw;
    }

    // Check for Nesting
    const braceIdx = key.indexOf('[');

    if (braceIdx === -1) {
      if (this.options.strictMode && key.includes(']')) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unbalanced brackets in key "${key}"`,
        });
      }

      this.assignLeaf(res, key, val);

      return;
    }

    if (!this.options.parseArrays) {
      if (this.options.strictMode) {
        const bracketResult = this.validateBrackets(key);

        if (isErr(bracketResult)) {
          return bracketResult;
        }
      }

      this.assignLeaf(res, key, val);

      return;
    }

    return this.parseComplexKey(res, key, braceIdx, val);
  }

  /**
   * Validates bracket balance in a key string (strict mode only).
   */
  private validateBrackets(key: string): Err<QueryParserErrorData> | undefined {
    let open = 0;

    for (let i = 0; i < key.length; i++) {
      const char = key[i];

      if (char === '[') {
        if (open > 0) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: nested brackets in key "${key}"`,
          });
        }

        open++;
      } else if (char === ']') {
        open--;

        if (open < 0) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: unbalanced brackets in key "${key}"`,
          });
        }
      }
    }

    if (open !== 0) {
      return err<QueryParserErrorData>({
        reason: QueryParserErrorReason.MalformedQueryString,
        message: `Malformed query string: unclosed bracket in key "${key}"`,
      });
    }
  }

  private parseComplexKey(
    root: QueryValueRecord,
    key: string,
    firstBrace: number,
    value: string,
  ): Err<QueryParserErrorData> | undefined {
    let current: QueryContainer = root;
    let depth = 0;
    const maxDepth = this.options.depth;
    const rootKey = key.slice(0, firstBrace);

    if (rootKey === '' || POISONED_KEYS.has(rootKey)) {
      return;
    }

    // State machine for parsing brackets
    let i = firstBrace;
    const len = key.length;
    let partStart = -1;
    const keys: string[] = [rootKey];

    while (i < len) {
      const code = key.charCodeAt(i);

      if (code === 91) {
        // '['
        if (partStart !== -1 && this.options.strictMode) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: nested brackets in key "${key}"`,
          });
        }

        partStart = i + 1;
      } else if (code === 93) {
        // ']'
        if (partStart !== -1) {
          keys.push(key.slice(partStart, i));
          partStart = -1;
        } else if (this.options.strictMode) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: unbalanced brackets in key "${key}"`,
          });
        }
      }

      i++;
    }

    // Unclosed bracket
    if (partStart !== -1) {
      if (this.options.strictMode) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unclosed bracket in key "${key}"`,
        });
      }

      this.assignLeaf(root, key, value);

      return;
    }

    if (keys.length === 1) {
      this.assignLeaf(root, key, value);

      return;
    }

    // Initialize/Validate root container
    if (!Object.prototype.hasOwnProperty.call(root, rootKey)) {
      const nextKey = keys[1] ?? '';

      root[rootKey] = this.shouldCreateArray(nextKey) ? [] : {};
    } else {
      if (typeof root[rootKey] !== 'object' || root[rootKey] === null) {
        if (this.options.strictMode) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: key "${rootKey}" is both a scalar and a nested structure`,
          });
        }

        const nextKey = keys[1] ?? '';

        root[rootKey] = this.shouldCreateArray(nextKey) ? [] : {};
      }
    }

    let parent: QueryContainer = root;
    let parentKey: string | number = rootKey;
    const rootContainer = root[rootKey];

    if (this.isRecordValue(rootContainer) || Array.isArray(rootContainer)) {
      current = rootContainer;
    } else {
      return;
    }

    // Traverse and build from 2nd key match
    for (let k = 1; k < keys.length; k++) {
      const prop = keys[k] ?? '';
      const isLast = k === keys.length - 1;

      if (depth >= maxDepth) {
        return;
      }

      // Pollution check — BEFORE any property access
      if (POISONED_KEYS.has(prop)) {
        return;
      }

      // Conversion: Array with non-numeric key → Object
      if (Array.isArray(current) && prop !== '' && !this.isValidArrayIndex(prop)) {
        if (this.options.strictMode) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: non-numeric key "${prop}" used on an array structure at "${parentKey}"`,
          });
        }

        current = this.arrayToObject(current);

        if (Array.isArray(parent)) {
          const normalizedKey = this.normalizeKey(parentKey);

          this.assignArrayRecordValue(parent, normalizedKey, current);
        } else if (this.isRecordValue(parent)) {
          parent[this.normalizeKey(parentKey)] = current;
        } else {
          return;
        }
      }

      if (Array.isArray(current)) {
        if (prop === '') {
          if (isLast) {
            this.assignLeaf(current, prop, value);
            depth++;

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          const nextContainer: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

          current.push(nextContainer);
          parent = current;
          parentKey = current.length - 1;
          current = nextContainer;
          depth++;

          continue;
        }

        if (this.isValidArrayIndex(prop)) {
          const index = parseInt(prop, 10);

          if (index > this.options.arrayLimit) {
            return;
          }

          if (isLast) {
            this.assignLeaf(current, prop, value);
            depth++;

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          let nextValue = current[index];

          if (!this.isRecordValue(nextValue) && !Array.isArray(nextValue)) {
            nextValue = this.shouldCreateArray(nextKey) ? [] : {};
            this.assignArrayRecordValue(current, prop, nextValue);
          }

          parent = current;
          parentKey = prop;
          current = nextValue;
          depth++;

          continue;
        }
      }

      if (isLast) {
        const leafResult = this.assignLeafStrict(current, prop, value);

        if (isErr(leafResult)) {
          return leafResult;
        }
      } else {
        // Create next container
        if (this.isRecordValue(current) && !Object.prototype.hasOwnProperty.call(current, prop)) {
          const nextKey = keys[k + 1] ?? '';

          current[prop] = this.shouldCreateArray(nextKey) ? [] : {};
        } else if (this.isRecordValue(current)) {
          const target = current[prop];

          if (typeof target !== 'object' || target === null) {
            if (this.options.strictMode) {
              return err<QueryParserErrorData>({
                reason: QueryParserErrorReason.ConflictingStructure,
                message: `Conflict: key "${prop}" is both a scalar and a nested structure`,
              });
            }

            const nextKey = keys[k + 1] ?? '';

            current[prop] = this.shouldCreateArray(nextKey) ? [] : {};
          }
        }

        // Advance
        parent = current;
        parentKey = prop;

        const nextValue = this.isRecordValue(current) ? current[prop] : undefined;

        if (this.isRecordValue(nextValue) || Array.isArray(nextValue)) {
          current = nextValue;
        } else {
          return;
        }
      }

      depth++;
    }
  }

  private shouldCreateArray(nextKey: string): boolean {
    if (nextKey === '') {
      return true;
    }

    if (this.isValidArrayIndex(nextKey)) {
      const n = parseInt(nextKey, 10);

      return n >= 0 && n <= this.options.arrayLimit;
    }

    return false;
  }

  /**
   * Assigns a value to a leaf position. Used in non-strict contexts
   * where errors are silently ignored.
   */
  private assignLeaf(obj: QueryContainer, key: string, value: string): void {
    if (POISONED_KEYS.has(key)) {
      return;
    }

    if (key === '' && Array.isArray(obj)) {
      obj.push(value);

      return;
    }

    if (Array.isArray(obj)) {
      if (this.isValidArrayIndex(key)) {
        const idx = parseInt(key, 10);

        if (idx > this.options.arrayLimit) {
          return;
        }

        this.assignArrayRecordValue(obj, key, value);
      } else {
        this.assignArrayRecordValue(obj, key, value);
      }

      return;
    }

    if (!this.isRecordValue(obj)) {
      return;
    }

    this.assignToRecord(obj, key, value);
  }

  /**
   * Assigns a value to a leaf position with strict mode error reporting.
   */
  private assignLeafStrict(obj: QueryContainer, key: string, value: string): Err<QueryParserErrorData> | undefined {
    if (POISONED_KEYS.has(key)) {
      return;
    }

    if (key === '' && Array.isArray(obj)) {
      obj.push(value);

      return;
    }

    if (Array.isArray(obj)) {
      if (this.isValidArrayIndex(key)) {
        const idx = parseInt(key, 10);

        if (idx > this.options.arrayLimit) {
          return;
        }

        this.assignArrayRecordValue(obj, key, value);
      } else {
        if (this.options.strictMode) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: non-numeric key "${key}" used on an array structure`,
          });
        }

        this.assignArrayRecordValue(obj, key, value);
      }

      return;
    }

    if (!this.isRecordValue(obj)) {
      return;
    }

    return this.assignToRecordStrict(obj, key, value);
  }

  /**
   * Assigns a value to a record, handling HPP mode and conflict detection.
   */
  private assignToRecord(obj: QueryValueRecord, key: string, value: string): void {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      obj[key] = value;

      return;
    }

    const existing = obj[key];

    if (typeof existing === 'object' && existing !== null) {
      if (Array.isArray(existing) && this.options.hppMode === 'array') {
        existing.push(value);

        return;
      }

      if (this.options.hppMode !== 'last') {
        return;
      }
    }

    if (this.options.hppMode === 'first') {
      return;
    }

    if (this.options.hppMode === 'last') {
      obj[key] = value;

      return;
    }

    // Array mode
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      obj[key] = existing === undefined ? [value] : [existing, value];
    }
  }

  /**
   * Assigns a value to a record with strict mode reporting.
   */
  private assignToRecordStrict(obj: QueryValueRecord, key: string, value: string): Err<QueryParserErrorData> | undefined {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      obj[key] = value;

      return;
    }

    const existing = obj[key];

    if (typeof existing === 'object' && existing !== null) {
      if (Array.isArray(existing) && this.options.hppMode === 'array') {
        existing.push(value);

        return;
      }

      if (this.options.strictMode) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: key "${key}" is a nested structure but being assigned a scalar value`,
        });
      }

      if (this.options.hppMode !== 'last') {
        return;
      }
    }

    if (this.options.hppMode === 'first') {
      return;
    }

    if (this.options.hppMode === 'last') {
      obj[key] = value;

      return;
    }

    // Array mode
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      obj[key] = existing === undefined ? [value] : [existing, value];
    }
  }

  private assignArrayRecordValue(target: QueryArray, key: string, value: QueryValue): void {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  private normalizeKey(key: string | number): string {
    return typeof key === 'number' ? key.toString() : key;
  }

  /**
   * Checks if a string represents a valid non-negative integer for array indexing.
   * Rejects: negative numbers, floats, empty strings, non-numeric strings, leading zeros.
   */
  private isValidArrayIndex(str: string): boolean {
    if (str.length === 0 || str.length > 10) {
      return false;
    }

    const code = str.charCodeAt(0);

    // First char must be 0-9
    if (code < 48 || code > 57) {
      return false;
    }

    // Reject leading zeros (except "0" itself)
    if (code === 48 && str.length > 1) {
      return false;
    }

    for (let i = 1; i < str.length; i++) {
      const c = str.charCodeAt(i);

      if (c < 48 || c > 57) {
        return false;
      }
    }

    return true;
  }

  /**
   * Converts an array to an object where indices become string keys.
   */
  private arrayToObject(arr: QueryArray): QueryValueRecord {
    const obj: QueryValueRecord = {};

    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i];

      if (entry !== undefined) {
        obj[i.toString()] = entry;
      }
    }

    return obj;
  }

  private isRecordValue(value: QueryValue | undefined): value is QueryValueRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
