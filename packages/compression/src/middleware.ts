import { defineMiddleware } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';
import { err, isErr } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import { HttpHeader, HttpStatus } from '@zipbul/shared';

import { BUFFER_COMPRESSORS } from './compressors.ts';
import { Encoding } from './enums.ts';
import { injectGzipPadding, injectZstdPadding } from './htb.ts';
import type { BreachOptions, CompressionErrorData, CompressionOptions } from './interfaces.ts';
import { BREACH_SAFE_ENCODINGS, resolveCompressionOptions, validateCompressionOptions } from './options.ts';
import { negotiateEncoding, parseAcceptEncoding } from './encoding.ts';

const encoder = new TextEncoder();

function serializeBody(body: string | number | boolean | Uint8Array | ArrayBuffer | object): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return encoder.encode(body);
  return encoder.encode(JSON.stringify(body));
}

function hasVaryEncoding(header: string): boolean {
  return header.split(',').some((v) => v.trim().toLowerCase() === 'accept-encoding');
}

function hasNoTransform(cacheControl: string): boolean {
  return cacheControl.split(',').some((d) => d.trim().toLowerCase() === 'no-transform');
}

function weakenETag(etag: string): string {
  return etag.startsWith('W/') ? etag : `W/${etag}`;
}

export function compressionMiddleware(
  opts?: CompressionOptions,
): Result<MiddlewareDefinition, CompressionErrorData> {
  const resolved = resolveCompressionOptions(opts);
  const breach: BreachOptions | undefined = opts?.breach;

  const validation = validateCompressionOptions(resolved, breach);
  if (isErr(validation)) return err(validation.data);

  // When BREACH mitigation is enabled, restrict to encodings with safe padding
  const effectiveEncodings = breach !== undefined
    ? resolved.encodings.filter((e) => BREACH_SAFE_ENCODINGS.has(e))
    : resolved.encodings;

  return defineMiddleware([HttpAdapter], (ctx) => {
    const http = ctx.to(HttpContext);
    const { request, response } = http;

    // RFC 9110 §15: skip responses that MUST NOT have a body
    const status = response.getStatus() as number;
    if (
      status < 200
      || status === HttpStatus.NoContent
      || status === HttpStatus.ResetContent
      || status === HttpStatus.NotModified
    ) return;

    // RFC 9110 §9.3.2: HEAD responses MUST NOT have content
    if (request.httpMethod === 'HEAD') return;

    const body = response.getBody();
    if (body === undefined || body === null) return;
    if (response.getHeader(HttpHeader.ContentEncoding) !== null) return;

    // RFC 9110 §12.5.1: Vary must be set whenever Accept-Encoding is considered,
    // regardless of whether compression is actually applied.
    const existingVary = response.getHeader(HttpHeader.Vary);
    if (existingVary === null || !hasVaryEncoding(existingVary)) {
      response.appendHeader(HttpHeader.Vary, HttpHeader.AcceptEncoding);
    }

    // RFC 9110 §7.7 + RFC 9111 §5.2.2.6: no-transform prohibits compression
    const cacheControl = response.getHeader(HttpHeader.CacheControl);
    if (cacheControl !== null && hasNoTransform(cacheControl)) return;

    const contentType = response.getContentType();
    if (contentType !== null && !resolved.filter(contentType)) return;

    // Check Accept-Encoding and negotiate before serializing body (avoids
    // wasteful JSON.stringify + TextEncoder.encode when no encoding matches).
    const acceptHeader = request.headers.get(HttpHeader.AcceptEncoding);
    if (acceptHeader === null || acceptHeader === '') return;

    const clientPrefs = parseAcceptEncoding(acceptHeader);
    const encoding = negotiateEncoding(effectiveEncodings, clientPrefs);
    if (encoding === null) return;

    const bytes = serializeBody(body);
    if (bytes.byteLength < resolved.threshold) return;

    let compressed: Uint8Array;
    try {
      compressed = BUFFER_COMPRESSORS[encoding](bytes, resolved.level[encoding]);
    } catch {
      return;
    }

    // BREACH mitigation: inject format-level padding
    if (breach !== undefined) {
      if (encoding === Encoding.Gzip) {
        compressed = injectGzipPadding(compressed, breach.maxPadding);
      } else if (encoding === Encoding.Zstd) {
        compressed = injectZstdPadding(compressed, breach.maxPadding);
      }
    }

    response
      .setBody(compressed)
      .setHeader(HttpHeader.ContentEncoding, encoding)
      .removeHeader(HttpHeader.ContentLength);

    // RFC 9110 §8.8.1: strong ETag must be weakened after content transformation
    const etag = response.getHeader(HttpHeader.ETag);
    if (etag !== null) {
      response.setHeader(HttpHeader.ETag, weakenETag(etag));
    }
  });
}
