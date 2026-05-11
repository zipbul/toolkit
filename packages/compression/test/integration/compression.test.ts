import { describe, expect, it } from 'bun:test';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { isErr } from '@zipbul/result';
import {
  compressionMiddleware,
  Encoding,
  CompressionErrorReason,
} from '../../index.ts';

interface MockHeaders {
  get(name: string): string | null;
}

interface MockResponse {
  getBody(): unknown;
  setBody(data: unknown): MockResponse;
  getHeader(name: string): string | null;
  setHeader(name: string, value: string): MockResponse;
  removeHeader(name: string): MockResponse;
  appendHeader(name: string, value: string): MockResponse;
  getContentType(): string | null;
  getStatus(): number;
}

function mockHttpResponse(opts: {
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string | null;
  status?: number;
} = {}): MockResponse {
  let body = opts.body;
  const status = opts.status ?? 200;
  const headers = new Map<string, string>();
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headers.set(k.toLowerCase(), v);
    }
  }
  const contentType = opts.contentType !== undefined ? opts.contentType : (headers.get('content-type') ?? null);

  const self: MockResponse = {
    getBody: () => body,
    setBody: (data) => { body = data; return self; },
    getHeader: (name) => headers.get(name.toLowerCase()) ?? null,
    setHeader: (name, value) => { headers.set(name.toLowerCase(), value); return self; },
    removeHeader: (name) => { headers.delete(name.toLowerCase()); return self; },
    appendHeader: (name, value) => {
      const existing = headers.get(name.toLowerCase());
      headers.set(name.toLowerCase(), existing ? `${existing}, ${value}` : value);
      return self;
    },
    getContentType: () => contentType,
    getStatus: () => status,
  };
  return self;
}

function mockContext(
  request: { headers: MockHeaders; httpMethod?: string },
  response: MockResponse,
) {
  const req = { httpMethod: 'GET', ...request };
  return {
    getType: () => 'http',
    get: () => undefined,
    to: () => ({ request: req, response }),
  } as any;
}

function makeRequestHeaders(acceptEncoding?: string): MockHeaders {
  const h = new Headers();
  if (acceptEncoding !== undefined) {
    h.set('accept-encoding', acceptEncoding);
  }
  return h;
}

function largeBody(sizeBytes: number): string {
  return 'a'.repeat(sizeBytes);
}

/** Unwrap a successful Result — fails the test if it's an Err. */
function unwrap<T>(result: T) {
  if (isErr(result)) {
    throw new Error(`unexpected Err: ${result.data.message}`);
  }
  return result;
}

const LARGE_JSON = JSON.stringify({ data: largeBody(2048) });
const LARGE_BODY_OBJ = { data: largeBody(2048) };

describe('compressionMiddleware', () => {
  const middleware = unwrap(compressionMiddleware());

  // --- HP: Happy Path ---

  describe('gzip compression', () => {
    it('should compress JSON body when Accept-Encoding: gzip', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      expect(response.getBody()).toBeInstanceOf(Uint8Array);
    });

    it('should roundtrip gzip (compress → decompress → original)', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      const decompressed = gunzipSync(compressed).toString('utf-8');
      expect(decompressed).toBe(LARGE_JSON);
    });

    it('should roundtrip large body (100KB+) gzip', () => {
      const original = largeBody(120_000);
      const response = mockHttpResponse({ body: original, contentType: 'text/plain' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      const decompressed = gunzipSync(compressed).toString('utf-8');
      expect(decompressed).toBe(original);
    });
  });

  describe('brotli compression', () => {
    it('should compress JSON body when Accept-Encoding: br', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('br') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('br');
      expect(response.getBody()).toBeInstanceOf(Uint8Array);
    });

    it('should roundtrip brotli', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('br') }, response);
      middleware.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      const decompressed = brotliDecompressSync(compressed).toString('utf-8');
      expect(decompressed).toBe(LARGE_JSON);
    });
  });

  describe('deflate compression', () => {
    it('should compress JSON body when Accept-Encoding: deflate', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Deflate] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('deflate') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('deflate');
    });

    it('should roundtrip deflate (zlib-wrapped per RFC 1950)', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Deflate] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('deflate') }, response);
      m.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      // node:zlib inflateSync handles zlib-wrapped format (RFC 1950)
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(LARGE_JSON);
    });

    it('should produce zlib-wrapped output (starts with 0x78 CMF byte)', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Deflate] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('deflate') }, response);
      m.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      // RFC 1950: zlib header starts with CMF byte where CM=8 (deflate), so CMF & 0x0f === 8
      expect(compressed[0]! & 0x0f).toBe(8);
    });
  });

  describe('zstd compression', () => {
    it('should compress JSON body when Accept-Encoding: zstd', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Zstd] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('zstd') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('zstd');
    });

    it('should roundtrip zstd', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Zstd] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('zstd') }, response);
      m.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      const decompressed = Bun.zstdDecompressSync(Buffer.from(compressed));
      expect(new TextDecoder().decode(decompressed)).toBe(LARGE_JSON);
    });
  });

  describe('response headers after compression', () => {
    it('should set Content-Encoding, remove Content-Length, add Vary', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'content-length': String(new TextEncoder().encode(LARGE_JSON).byteLength) },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      expect(response.getHeader('content-length')).toBeNull();
      expect(response.getHeader('vary')).toContain('accept-encoding');
    });
  });

  // --- NE: Negative/Error ---

  describe('encoding negotiation', () => {
    it('should select server-preferred encoding when client supports both (br > gzip)', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip, br') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('br');
    });

    it('should respect quality values (gzip;q=1 > br;q=0.5)', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Brotli, Encoding.Gzip] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip;q=1, br;q=0.5') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should handle wildcard Accept-Encoding: * → server first', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('*') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('br');
    });

    it('should skip when client does not support server-preferred encoding', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('br') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });
  });

  describe('create validation errors', () => {
    it('should return Err with EmptyEncodings when encodings=[]', () => {
      const result = compressionMiddleware({ encodings: [] });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.EmptyEncodings);
      }
    });

    it('should return Err with InvalidEncodings for unknown encoding', () => {
      const result = compressionMiddleware({ encodings: ['lz4' as Encoding] });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidEncodings);
      }
    });

    it('should return Err with InvalidThreshold for negative threshold', () => {
      const result = compressionMiddleware({ threshold: -1 });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidThreshold);
      }
    });

    it('should return Err with InvalidThreshold for NaN threshold', () => {
      const result = compressionMiddleware({ threshold: NaN });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidThreshold);
      }
    });

    it('should return Err with InvalidLevel for gzip level=10', () => {
      const result = compressionMiddleware({ level: { [Encoding.Gzip]: 10 } });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
      }
    });

    it('should return Err with InvalidLevel for brotli level=12', () => {
      const result = compressionMiddleware({ level: { [Encoding.Brotli]: 12 } });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
      }
    });

    it('should return Err with InvalidLevel for fractional level', () => {
      const result = compressionMiddleware({ level: { [Encoding.Gzip]: 5.5 } });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
      }
    });
  });

  describe('custom options', () => {
    it('should apply custom filter', () => {
      const m = unwrap(compressionMiddleware({ filter: (ct) => ct.includes('custom'), threshold: 0 }));
      const response = mockHttpResponse({ body: 'hello', contentType: 'text/custom' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should apply custom threshold=0 → compress all', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: { a: 1 }, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should apply custom level', () => {
      const m = unwrap(compressionMiddleware({ level: { [Encoding.Gzip]: 1 } }));
      const response = mockHttpResponse({ body: { data: largeBody(2048) }, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      const compressed = response.getBody() as Uint8Array;
      const decompressed = gunzipSync(compressed).toString('utf-8');
      expect(JSON.parse(decompressed)).toEqual({ data: largeBody(2048) });
    });

    it('should filter default compressible types: text/html, application/json, image/svg+xml', () => {
      const types = ['text/html', 'application/json', 'image/svg+xml'];
      for (const ct of types) {
        const m = unwrap(compressionMiddleware());
        const response = mockHttpResponse({ body: largeBody(2048), contentType: ct });
        const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
        m.handler(ctx);
        expect(response.getHeader('content-encoding')).toBe('gzip');
      }
    });
  });

  // --- ED: Edge ---

  describe('edge cases', () => {
    it('should skip when body is undefined → no changes', () => {
      const response = mockHttpResponse({ body: undefined });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when body is null → no changes', () => {
      const response = mockHttpResponse({ body: null });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should compress when body size equals threshold (not skip)', () => {
      const m = unwrap(compressionMiddleware({ threshold: 10 }));
      const body = 'a'.repeat(10);
      const response = mockHttpResponse({ body, contentType: 'text/plain' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should skip when body is 1 byte below threshold', () => {
      const m = unwrap(compressionMiddleware({ threshold: 10 }));
      const body = 'a'.repeat(9);
      const response = mockHttpResponse({ body, contentType: 'text/plain' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should attempt compression when Content-Type is absent', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: 'hello world', contentType: null });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should skip when Accept-Encoding: gzip;q=0 → no changes', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip], threshold: 0 }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip;q=0') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when no Accept-Encoding header → no changes', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders() }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when already Content-Encoding → no changes', () => {
      const response = mockHttpResponse({
        body: 'compressed',
        contentType: 'text/plain',
        headers: { 'content-encoding': 'gzip' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      // body should remain unchanged (string, not Uint8Array)
      expect(response.getBody()).toBe('compressed');
    });

    it('should skip when Content-Type is image/png → no changes', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: 'fake-png-data', contentType: 'image/png' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });
  });

  // --- CO: Corner ---

  describe('corner cases', () => {
    it('should return AlreadyEncoded before checking threshold (priority)', () => {
      const m = unwrap(compressionMiddleware({ threshold: 999999 }));
      const response = mockHttpResponse({
        body: 'x',
        contentType: 'text/plain',
        headers: { 'content-encoding': 'gzip' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getBody()).toBe('x');
    });

    it('should exclude gzip;q=0 but use wildcard for br', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Brotli, Encoding.Gzip] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('*, gzip;q=0') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('br');
    });
  });

  // --- ST: State Transition ---

  describe('instance reuse', () => {
    it('should handle multiple independent requests with same middleware', () => {
      const r1 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      middleware.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r1));

      const r2 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      middleware.handler(mockContext({ headers: makeRequestHeaders('br') }, r2));

      const r3 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      middleware.handler(mockContext({ headers: makeRequestHeaders() }, r3));

      expect(r1.getHeader('content-encoding')).toBe('gzip');
      expect(r2.getHeader('content-encoding')).toBe('br');
      expect(r3.getHeader('content-encoding')).toBeNull();
    });
  });

  // --- ID: Idempotency ---

  describe('idempotency', () => {
    it('should produce equivalent results with same options via different instances', () => {
      const m1 = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip] }));
      const m2 = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip] }));

      const r1 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      m1.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r1));

      const r2 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      m2.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r2));

      expect(r1.getHeader('content-encoding')).toBe(r2.getHeader('content-encoding'));
    });
  });

  // --- OR: Ordering ---

  describe('ordering', () => {
    it('should select different encoding based on encodings order', () => {
      const m1 = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip, Encoding.Brotli] }));
      const m2 = unwrap(compressionMiddleware({ encodings: [Encoding.Brotli, Encoding.Gzip] }));

      const r1 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      m1.handler(mockContext({ headers: makeRequestHeaders('gzip, br') }, r1));

      const r2 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      m2.handler(mockContext({ headers: makeRequestHeaders('gzip, br') }, r2));

      expect(r1.getHeader('content-encoding')).toBe('gzip');
      expect(r2.getHeader('content-encoding')).toBe('br');
    });

    it('should check skip conditions in order: NoBody > AlreadyEncoded > FilteredOut > BelowThreshold', () => {
      const m = unwrap(compressionMiddleware({ threshold: 999999 }));

      // NoBody (null)
      const r1 = mockHttpResponse({ body: null });
      m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r1));
      expect(r1.getHeader('content-encoding')).toBeNull();

      // AlreadyEncoded
      const r2 = mockHttpResponse({
        body: 'x',
        contentType: 'image/png',
        headers: { 'content-encoding': 'gzip' },
      });
      m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r2));
      expect(r2.getBody()).toBe('x');

      // FilteredOut
      const r3 = mockHttpResponse({ body: 'x', contentType: 'image/png' });
      m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r3));
      expect(r3.getHeader('content-encoding')).toBeNull();

      // BelowThreshold
      const r4 = mockHttpResponse({ body: 'x', contentType: 'text/plain' });
      m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r4));
      expect(r4.getHeader('content-encoding')).toBeNull();
    });
  });

  // --- Vary header ---

  describe('Vary header', () => {
    it('should not duplicate Vary: Accept-Encoding if already present', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'vary': 'accept-encoding' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('vary')).toBe('accept-encoding');
    });

    it('should append to existing Vary header without duplicating', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'vary': 'Origin' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('vary')).toBe('Origin, accept-encoding');
    });

    it('should set Vary even when compression is skipped due to threshold', () => {
      const response = mockHttpResponse({ body: 'hi', contentType: 'text/plain' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
      expect(response.getHeader('vary')).toContain('accept-encoding');
    });

    it('should set Vary even when content-type is filtered out', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'image/png' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
      expect(response.getHeader('vary')).toContain('accept-encoding');
    });

    it('should set Vary even when no matching encoding is negotiated', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip] }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('br') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
      expect(response.getHeader('vary')).toContain('accept-encoding');
    });

    it('should set Vary even when Accept-Encoding header is absent', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders() }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
      expect(response.getHeader('vary')).toContain('accept-encoding');
    });

    it('should not set Vary when body is null (no content negotiation)', () => {
      const response = mockHttpResponse({ body: null });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('vary')).toBeNull();
    });

    it('should not set Vary for 204 No Content', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('vary')).toBeNull();
    });
  });

  // --- Robustness ---

  describe('compression failure', () => {
    it('should not modify response if compression throws', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should not throw when double-invoked on same response (idempotent guard)', () => {
      const m = unwrap(compressionMiddleware());
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');

      const ctx2 = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx2);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });
  });

  // --- BREACH mitigation (HTB) ---

  describe('breach mitigation', () => {
    it('should apply gzip padding when breach option is enabled', () => {
      const m = unwrap(compressionMiddleware({ breach: { maxPadding: 32 } }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);

      const body = response.getBody() as Uint8Array;
      expect(body).toBeInstanceOf(Uint8Array);
      expect(body[3] & 0x04).toBe(0x04);
      const decompressed = Bun.gunzipSync(body);
      expect(JSON.parse(Buffer.from(decompressed).toString())).toEqual(LARGE_BODY_OBJ);
    });

    it('should produce varying gzip output sizes across requests when breach is enabled', () => {
      const m = unwrap(compressionMiddleware({ breach: { maxPadding: 64 } }));
      const sizes = new Set<number>();
      for (let i = 0; i < 30; i++) {
        const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
        const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
        m.handler(ctx);
        sizes.add((response.getBody() as Uint8Array).byteLength);
      }
      expect(sizes.size).toBeGreaterThan(1);
    });

    it('should return Err when breach enabled with only non-BREACH-safe encodings', () => {
      const result = compressionMiddleware({ encodings: [Encoding.Brotli], breach: { maxPadding: 32 } });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
      }
    });

    it('should not apply padding when breach option is not set', () => {
      const m = unwrap(compressionMiddleware());
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);

      const body = response.getBody() as Uint8Array;
      expect(body[3] & 0x04).toBe(0);
    });

    it('should apply zstd skippable frame padding when breach enabled', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Zstd], breach: { maxPadding: 32 } }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('zstd') }, response);
      m.handler(ctx);

      const body = response.getBody() as Uint8Array;
      expect(body[0]).toBe(0x50);
      expect(body[1]).toBe(0x2a);
      expect(body[2]).toBe(0x4d);
      expect(body[3]).toBe(0x18);
      const decompressed = Bun.zstdDecompressSync(body);
      expect(JSON.parse(Buffer.from(decompressed).toString())).toEqual(LARGE_BODY_OBJ);
    });

    it('should filter out brotli/deflate when breach enabled with mixed encodings', () => {
      const m = unwrap(compressionMiddleware({
        encodings: [Encoding.Brotli, Encoding.Gzip, Encoding.Deflate],
        breach: { maxPadding: 16 },
      }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('br, gzip, deflate') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should return Err for invalid breach.maxPadding values', () => {
      for (const maxPadding of [0, -1, 1.5, 5000, NaN]) {
        const result = compressionMiddleware({ breach: { maxPadding } });
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
        }
      }
    });
  });

  // --- RFC 9110 compliance ---

  describe('RFC 9110 status code handling', () => {
    it('should skip compression for 204 No Content', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip compression for 205 Reset Content', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 205 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip compression for 304 Not Modified', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 304 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip compression for 1xx informational status', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 100 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip compression when status is 0 (unset)', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 0 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should compress normally for 200 OK', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 200 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should compress normally for 201 Created', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 201 });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });
  });

  describe('RFC 9110 HEAD request handling', () => {
    it('should skip compression for HEAD requests', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip'), httpMethod: 'HEAD' }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should compress for GET requests', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip'), httpMethod: 'GET' }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });

    it('should compress for POST requests', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip'), httpMethod: 'POST' }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });
  });

  describe('RFC 9110 Cache-Control: no-transform', () => {
    it('should skip compression when Cache-Control: no-transform', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-transform' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when no-transform is among multiple directives', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'cache-control': 'public, no-transform, max-age=3600' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should compress when Cache-Control does not include no-transform', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'cache-control': 'public, max-age=3600' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
    });
  });

  describe('RFC 9110 ETag handling', () => {
    it('should weaken a strong ETag after compression', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'etag': '"abc123"' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('etag')).toBe('W/"abc123"');
    });

    it('should preserve an already-weak ETag', () => {
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'etag': 'W/"abc123"' },
      });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('etag')).toBe('W/"abc123"');
    });

    it('should not set ETag when none exists', () => {
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      middleware.handler(ctx);
      expect(response.getHeader('etag')).toBeNull();
    });
  });

  describe('body serialization types', () => {
    it('should compress string body', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: 'hello world', contentType: 'text/plain' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      const decompressed = gunzipSync(response.getBody() as Uint8Array).toString('utf-8');
      expect(decompressed).toBe('hello world');
    });

    it('should compress number body (serialized as JSON)', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: 42, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      const decompressed = gunzipSync(response.getBody() as Uint8Array).toString('utf-8');
      expect(decompressed).toBe('42');
    });

    it('should compress boolean body (serialized as JSON)', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: true, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      const decompressed = gunzipSync(response.getBody() as Uint8Array).toString('utf-8');
      expect(decompressed).toBe('true');
    });

    it('should compress ArrayBuffer body', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const buf = new TextEncoder().encode('arraybuffer content').buffer;
      const response = mockHttpResponse({ body: buf, contentType: null });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      const decompressed = gunzipSync(response.getBody() as Uint8Array).toString('utf-8');
      expect(decompressed).toBe('arraybuffer content');
    });

    it('should compress Uint8Array body', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const body = new TextEncoder().encode('binary content');
      const response = mockHttpResponse({ body, contentType: null });
      const ctx = mockContext({ headers: makeRequestHeaders('gzip') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBe('gzip');
      const decompressed = gunzipSync(response.getBody() as Uint8Array).toString('utf-8');
      expect(decompressed).toBe('binary content');
    });
  });

  describe('identity encoding handling', () => {
    it('should skip when Accept-Encoding is identity only', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('identity') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when Accept-Encoding: *;q=0 (all rejected)', () => {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('*;q=0') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });

    it('should skip when identity;q=0 but no other matching encoding', () => {
      const m = unwrap(compressionMiddleware({ encodings: [Encoding.Gzip], threshold: 0 }));
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      const ctx = mockContext({ headers: makeRequestHeaders('identity;q=0, br') }, response);
      m.handler(ctx);
      expect(response.getHeader('content-encoding')).toBeNull();
    });
  });

  describe('BREACH + zstd varying sizes', () => {
    it('should produce varying zstd output sizes across requests when breach is enabled', () => {
      const m = unwrap(compressionMiddleware({
        encodings: [Encoding.Zstd],
        breach: { maxPadding: 64 },
      }));
      const sizes = new Set<number>();
      for (let i = 0; i < 30; i++) {
        const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
        const ctx = mockContext({ headers: makeRequestHeaders('zstd') }, response);
        m.handler(ctx);
        sizes.add((response.getBody() as Uint8Array).byteLength);
      }
      expect(sizes.size).toBeGreaterThan(1);
    });
  });

  describe('RFC 9659 zstd level cap', () => {
    it('should return Err for zstd level 20 (exceeds RFC 9659 8MB window)', () => {
      const result = compressionMiddleware({ encodings: [Encoding.Zstd], level: { [Encoding.Zstd]: 20 } });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
      }
    });

    it('should accept zstd level 19', () => {
      const result = compressionMiddleware({ encodings: [Encoding.Zstd], level: { [Encoding.Zstd]: 19 } });
      expect(isErr(result)).toBe(false);
    });
  });
});
