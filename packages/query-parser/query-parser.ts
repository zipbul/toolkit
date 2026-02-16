import type { QueryParserOptions } from './interfaces';
import type { QueryArray, QueryContainer, QueryValue, QueryValueRecord } from './types';

import { BadRequestError } from '../../errors';
import { DEFAULT_QUERY_PARSER_OPTIONS } from './constants';

/**
 * High-performance, Strict Query String Parser
 * Impements RFC 3986 compliance with strict security controls.
 */
export class QueryParser {
  private readonly options: Required<QueryParserOptions>;

  constructor(options: QueryParserOptions = {}) {
    this.options = { ...DEFAULT_QUERY_PARSER_OPTIONS, ...options };
  }

  public parse(qs: string): QueryValueRecord {
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
        // End of pair
        if (keyEnd === -1) {
          // Key without value (flag)
          keyEnd = i;
          valStart = i; // Empty value implied
        }

        this.processPair(res, qs, keyStart, keyEnd, valStart, i);

        paramCount++;

        if (paramCount >= this.options.parameterLimit) {
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

    // Process last pair
    if (keyStart < len) {
      if (keyEnd === -1) {
        keyEnd = len;
        valStart = len;
      }

      this.processPair(res, qs, keyStart, keyEnd, valStart, len);
    }

    return res;
  }

  private processPair(res: QueryValueRecord, qs: string, keyStart: number, keyEnd: number, valStart: number, valEnd: number) {
    // Decode Key
    const keyRaw = qs.slice(keyStart, keyEnd);
    // Fast check for encoded
    const key = keyRaw.includes('%') ? decodeURIComponent(keyRaw) : keyRaw;

    if (!key) {
      return;
    } // Ignore empty keys

    // Decode Value
    let val = '';

    if (valStart < valEnd) {
      const valRaw = qs.slice(valStart, valEnd);

      val = valRaw.includes('%') ? decodeURIComponent(valRaw) : valRaw;
    }

    // Check for Nesting
    const braceIdx = key.indexOf('[');

    if (braceIdx === -1) {
      // Strict Mode: Check for unbalanced closing brackets even in flat keys
      if (this.options.strictMode && key.includes(']')) {
        throw new BadRequestError(`Malformed query string: unbalanced brackets in key "${key}"`);
      }

      // Simple assignment
      this.assignLeaf(res, key, val);

      return;
    }

    if (!this.options.parseArrays) {
      // Strict Mode: Check for bracket issues even if not parsing arrays
      if (this.options.strictMode) {
        // Check for unbalanced and nested brackets
        let open = 0;

        for (let i = 0; i < key.length; i++) {
          const char = key[i];

          if (char === '[') {
            if (open > 0) {
              throw new BadRequestError(`Malformed query string: nested brackets in key "${key}"`);
            }

            open++;
          } else if (char === ']') {
            open--;

            if (open < 0) {
              throw new BadRequestError(`Malformed query string: unbalanced brackets in key "${key}"`);
            }
          }
        }

        if (open !== 0) {
          throw new BadRequestError(`Malformed query string: unclosed bracket in key "${key}"`);
        }
      }

      // Treat as flat key if options disable array
      this.assignLeaf(res, key, val);

      return;
    }

    // Complex Parsing logic
    this.parseComplexKey(res, key, braceIdx, val);
  }

  private parseComplexKey(root: QueryValueRecord, key: string, firstBrace: number, value: string) {
    let current: QueryContainer = root;
    let depth = 0;
    const maxDepth = this.options.depth;
    // Root key part "user" from "user[name]"
    const rootKey = key.slice(0, firstBrace);

    // Strictness: Ignore empty root keys from brackets e.g. "[foo]=bar"
    if (rootKey === '') {
      return;
    }

    // Security Check for Root Key
    if (
      rootKey === '__proto__' ||
      rootKey === 'constructor' ||
      rootKey === 'prototype' ||
      rootKey === '__defineGetter__' ||
      rootKey === '__defineSetter__'
    ) {
      return;
    }

    // State machine for Parsing Brackets
    let i = firstBrace;
    const len = key.length;
    let partStart = -1;
    const keys: string[] = [rootKey];

    while (i < len) {
      const code = key.charCodeAt(i);

      if (code === 91) {
        // '['
        if (partStart !== -1 && this.options.strictMode) {
          throw new BadRequestError(`Malformed query string: nested brackets in key "${key}"`);
        }

        partStart = i + 1;
      } else if (code === 93) {
        // ']'
        if (partStart !== -1) {
          keys.push(key.slice(partStart, i));

          partStart = -1;
        } else if (this.options.strictMode) {
          throw new BadRequestError(`Malformed query string: unbalanced brackets in key "${key}"`);
        }
      }

      i++;
    }

    // Strict Validation for Unclosed Brackets
    if (partStart !== -1) {
      if (this.options.strictMode) {
        throw new BadRequestError(`Malformed query string: unclosed bracket in key "${key}"`);
      }

      // Non-strict: treat as literal key if not properly closed
      this.assignLeaf(root, key, value);

      return;
    }

    // If no keys were extracted beyond root, it means something like "key[]" where only "key" was slice(0, firstBrace)
    if (keys.length === 1) {
      this.assignLeaf(root, key, value);

      return;
    }

    // Initialize/Validate root container
    if (!Object.prototype.hasOwnProperty.call(root, rootKey)) {
      const nextKey = keys[1] ?? '';

      if (this.shouldCreateArray(nextKey)) {
        root[rootKey] = [];
      } else {
        root[rootKey] = {};
      }
    } else {
      // Conflict Detection: Flatten vs Nested
      if (typeof root[rootKey] !== 'object' || root[rootKey] === null) {
        if (this.options.strictMode) {
          throw new BadRequestError(`Conflict: key "${rootKey}" is both a scalar and a nested structure`);
        }

        // Non-strict: overwrite scalar with container
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

    // Now traverse and build from 2nd key match
    for (let k = 1; k < keys.length; k++) {
      const prop = keys[k] ?? '';
      const isLast = k === keys.length - 1;

      if (depth >= maxDepth) {
        return;
      } // Stop if too deep

      // Case 2: Conversion Check - Existing is Array but next key is non-numeric -> Convert to Object
      if (Array.isArray(current) && prop !== '' && !this.isValidArrayIndex(prop)) {
        if (this.options.strictMode) {
          throw new BadRequestError(`Conflict: non-numeric key "${prop}" used on an array structure at "${parentKey}"`);
        }

        current = this.arrayToMaybeObject(current);

        if (Array.isArray(parent)) {
          const normalizedKey = this.normalizeKey(parentKey);

          this.assignArrayRecordValue(parent, normalizedKey, current);
        } else if (this.isRecordValue(parent)) {
          const normalizedKey = this.normalizeKey(parentKey);

          parent[normalizedKey] = current;
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
        this.assignLeaf(current, prop, value);
      } else {
        // Create Next Container
        if (this.isRecordValue(current) && !Object.prototype.hasOwnProperty.call(current, prop)) {
          const nextKey = keys[k + 1] ?? '';

          if (this.shouldCreateArray(nextKey)) {
            current[prop] = [];
          } else {
            current[prop] = {};
          }
        } else if (this.isRecordValue(current)) {
          // Conflict Detection
          const target = current[prop];

          // Case 1: Existing is scalar but used as container
          if (typeof target !== 'object' || target === null) {
            if (this.options.strictMode) {
              throw new BadRequestError(`Conflict: key "${prop}" is both a scalar and a nested structure`);
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

        // Pollution Check
        if (
          prop === '__proto__' ||
          prop === 'constructor' ||
          prop === 'prototype' ||
          prop === '__defineGetter__' ||
          prop === '__defineSetter__'
        ) {
          return;
        }
      }

      depth++;
    }
  }

  private shouldCreateArray(nextKey: string): boolean {
    // Empty "[]" -> push to array
    if (nextKey === '') {
      return true;
    }

    // Index "[0]" -> array if limit satisfied
    if (this.isValidArrayIndex(nextKey)) {
      const n = parseInt(nextKey, 10);

      return n >= 0 && n <= this.options.arrayLimit;
    }

    return false;
  }

  private assignLeaf(obj: QueryContainer, key: string, value: string) {
    // Anti-Pollution for leaf
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      key === '__defineGetter__' ||
      key === '__defineSetter__'
    ) {
      return;
    }

    if (key === '' && Array.isArray(obj)) {
      obj.push(value);

      return;
    }

    // Strict Object/Array assignment
    if (Array.isArray(obj)) {
      // We are in an array context (e.g. user[0]=val or user[]=val)
      if (this.isValidArrayIndex(key)) {
        const idx = parseInt(key, 10);

        if (idx > this.options.arrayLimit) {
          return;
        } // Sparse Array Protection

        this.assignArrayRecordValue(obj, key, value);
      } else {
        // Mixed keys: Non-numeric key in array context
        if (this.options.strictMode) {
          throw new BadRequestError(`Conflict: non-numeric key "${key}" used on an array structure`);
        }

        this.assignArrayRecordValue(obj, key, value);
      }

      return;
    }

    // Object context
    if (!this.isRecordValue(obj)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const existing = obj[key];

      // Case 3: Existing is container, but current assignment is scalar
      if (typeof existing === 'object' && existing !== null) {
        // If hppMode is 'array', an array is a valid container for HPP values.
        if (Array.isArray(existing) && this.options.hppMode === 'array') {
          // Proceed to push
        } else {
          if (this.options.strictMode) {
            throw new BadRequestError(`Conflict: key "${key}" is a nested structure but being assigned a scalar value`);
          }

          if (this.options.hppMode !== 'last') {
            return;
          }
        }
      }

      if (this.options.hppMode === 'first') {
        // Do nothing
      } else if (this.options.hppMode === 'last') {
        obj[key] = value;
      } else {
        // Array Mode
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          obj[key] = existing === undefined ? [value] : [existing, value];
        }
      }
    } else {
      obj[key] = value;
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
   * Rejects: negative numbers, floats, empty strings, non-numeric strings.
   */
  private isValidArrayIndex(str: string): boolean {
    if (str.length > 10) {
      return false;
    } // Max int length guard

    const code = str.charCodeAt(0);

    // First char must be 0-9
    if (code < 48 || code > 57) {
      return false;
    }

    // Check all chars are digits (no dots, signs, etc.)
    for (let i = 1; i < str.length; i++) {
      const c = str.charCodeAt(i);

      if (c < 48 || c > 57) {
        return false;
      }
    }

    return true;
  }

  /**
   * Converts an array to an object where indices become keys.
   */
  private arrayToMaybeObject(arr: QueryArray): QueryValueRecord {
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
