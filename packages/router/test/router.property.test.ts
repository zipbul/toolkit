import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Router } from '../index';
import { RouterError } from '../index';
import type { MatchOutput } from '../index';

// ── Arbitraries ──

const URL_SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('');
const ALPHA_CHARS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ALPHANUM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** Generates a URL-safe segment: 1-20 alphanumeric + hyphen chars, starting with a letter. */
const segmentArb = fc
  .array(fc.constantFrom(...URL_SAFE_CHARS), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''))
  .filter((s) => /^[a-z]/.test(s));

/** Generates a valid static path like /seg1/seg2/seg3 with 1-5 segments. */
const staticPathArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 5 })
  .map((segments) => '/' + segments.join('/'));

/** Generates an HTTP method. */
const methodArb = fc.constantFrom(
  'GET' as const,
  'POST' as const,
  'PUT' as const,
  'DELETE' as const,
  'PATCH' as const,
  'HEAD' as const,
  'OPTIONS' as const,
);

/** Generates a param name: 2-10 lowercase letters. */
const paramNameArb = fc
  .array(fc.constantFrom(...ALPHA_CHARS), { minLength: 2, maxLength: 10 })
  .map((chars) => chars.join(''));

/** Generates a param value: 1-20 URL-safe alphanumeric chars. */
const paramValueArb = fc
  .array(fc.constantFrom(...ALPHANUM_CHARS), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''));

// ── Tests ──

describe('Router — property-based tests', () => {
  describe('round-trip invariant', () => {
    it('any route added via add() -> build() -> match() returns the registered value', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(methodArb, staticPathArb),
            { minLength: 1, maxLength: 20 },
          ),
          (routes) => {
            const seen = new Set<string>();
            const uniqueRoutes: Array<{ method: typeof routes[0][0]; path: string; value: number }> = [];

            for (const [method, path] of routes) {
              const key = `${method}:${path}`;

              if (!seen.has(key)) {
                seen.add(key);
                uniqueRoutes.push({ method, path, value: uniqueRoutes.length });
              }
            }

            const router = new Router<number>();

            for (const { method, path, value } of uniqueRoutes) {
              router.add(method, path, value);
            }

            router.build();

            for (const { method, path, value } of uniqueRoutes) {
              const result = router.match(method, path);
              expect(result).not.toBeNull();

              if (result !== null) {
                expect(result.value).toBe(value);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('params accuracy invariant', () => {
    it('match() result params contain the correct extracted values for parametric routes', () => {
      fc.assert(
        fc.property(
          fc
            .uniqueArray(paramNameArb, { minLength: 1, maxLength: 3, comparator: 'SameValue' })
            .chain((paramNames) =>
              fc.tuple(
                fc.constant(paramNames),
                fc.tuple(...paramNames.map(() => paramValueArb)),
                fc.array(segmentArb, { minLength: 0, maxLength: 2 }),
              ),
            ),
          ([paramNames, paramValues, prefixSegments]) => {
            const templateParts = [...prefixSegments, ...paramNames.map((n) => `:${n}`)];
            const template = '/' + templateParts.join('/');

            const concreteParts = [...prefixSegments, ...paramValues];
            const concretePath = '/' + concreteParts.join('/');

            const router = new Router<string>();
            router.add('GET', template, 'handler');
            router.build();

            const result = router.match('GET', concretePath);
            expect(result).not.toBeNull();

            if (result !== null) {
              expect(result.value).toBe('handler');

              for (let i = 0; i < paramNames.length; i++) {
                expect(result.params[paramNames[i]!]).toBe(paramValues[i]);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('idempotency invariant', () => {
    it('matching the same path N times returns identical results', () => {
      fc.assert(
        fc.property(
          methodArb,
          staticPathArb,
          (method, path) => {
            const router = new Router<string>();
            router.add(method, path, 'stable-handler');
            router.build();

            const results: Array<MatchOutput<string> | null> = [];

            for (let i = 0; i < 5; i++) {
              const result = router.match(method, path);
              results.push(result);
            }

            const first = results[0];
            expect(first).not.toBeNull();

            for (let i = 1; i < results.length; i++) {
              const current = results[i];
              expect(current).not.toBeNull();

              if (first != null && current != null) {
                expect(current.value).toBe(first.value);
                expect(current.params).toEqual(first.params);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('matching the same parametric path N times returns identical results', () => {
      fc.assert(
        fc.property(
          paramValueArb,
          (paramValue) => {
            const router = new Router<string>();
            router.add('GET', '/users/:id', 'user-handler');
            router.build();

            const concretePath = `/users/${paramValue}`;
            const results: Array<MatchOutput<string> | null> = [];

            for (let i = 0; i < 5; i++) {
              const result = router.match('GET', concretePath);
              results.push(result);
            }

            const first = results[0];
            expect(first).not.toBeNull();

            for (let i = 1; i < results.length; i++) {
              const current = results[i];
              expect(current).not.toBeNull();

              if (first != null && current != null) {
                expect(current.value).toBe(first.value);
                expect(current.params).toEqual(first.params);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('no-crash fuzz invariant', () => {
    it('any arbitrary string passed to match() does not crash', () => {
      const router = new Router<string>({ maxPathLength: 8192 });
      router.add('GET', '/users', 'users');
      router.add('GET', '/users/:id', 'user');
      router.add('GET', '/files/*path', 'files');
      router.add('POST', '/data', 'data');
      router.build();

      fc.assert(
        fc.property(
          fc.string({ unit: 'grapheme', minLength: 0, maxLength: 500 }),
          (arbitraryPath) => {
            // Must not crash — either returns a result or throws RouterError
            try {
              const result = router.match('GET', arbitraryPath);

              if (result !== null) {
                expect(result.value).toBeDefined();
                expect(result.params).toBeDefined();
                expect(result.meta).toBeDefined();
              }
            } catch (e) {
              // RouterError is expected for invalid paths
              expect(e).toBeInstanceOf(RouterError);
              const err = e as RouterError;
              expect(typeof err.data.kind).toBe('string');
              expect(typeof err.data.message).toBe('string');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('arbitrary strings with special characters never cause unhandled exceptions', () => {
      const router = new Router<string>({ maxPathLength: 8192 });
      router.add('GET', '/api/:version/resource', 'resource');
      router.add('GET', '/static/file', 'static');
      router.build();

      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ unit: 'grapheme', maxLength: 200 }).map((s) => '/' + encodeURIComponent(s)),
            fc.array(fc.string({ unit: 'grapheme', minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 10 })
              .map((parts) => '/' + parts.join('/')),
            fc.array(fc.constantFrom('a', '/', ':', '*', '.', '-', '%', '2', 'F'), {
              minLength: 100,
              maxLength: 500,
            }).map((chars) => chars.join('')),
            fc.string({ minLength: 1, maxLength: 200 }),
          ),
          (fuzzPath) => {
            // Must not crash with unhandled exception
            try {
              router.match('GET', fuzzPath);
            } catch (e) {
              // Only RouterError is acceptable
              expect(e).toBeInstanceOf(RouterError);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
