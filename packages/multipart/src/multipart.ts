import { isErr } from '@zipbul/result';
import { HttpHeader } from '@zipbul/shared';

import { MultipartErrorReason } from './enums';
import { MultipartError } from './interfaces';
import type { MultipartFile, MultipartOptions, MultipartPart } from './interfaces';
import { resolveMultipartOptions, validateMultipartOptions } from './options';
import { extractBoundary, parseMultipart, PartQueue, BufferingCallbacks, StreamingCallbacks, MultipartFileImpl } from './parser';
import type { ParseAllResult, ResolvedMultipartOptions } from './types';

/**
 * Streaming multipart/form-data parser built on Bun-native APIs.
 *
 * Uses a 5-state FSM with `Buffer.indexOf()` for zero-copy boundary detection.
 * File parts are streamed via TransformStream with native backpressure.
 * Field parts are buffered in memory (sync access).
 */
export class Multipart {
  private constructor(private readonly options: ResolvedMultipartOptions) {}

  /**
   * Creates a Multipart instance after resolving and validating options.
   *
   * @throws {MultipartError} when options fail validation.
   * @returns A ready-to-use Multipart instance.
   */
  public static create(options?: MultipartOptions): Multipart {
    const resolved = resolveMultipartOptions(options);
    const validation = validateMultipartOptions(resolved);

    if (isErr(validation)) {
      throw new MultipartError(validation.data);
    }

    return new Multipart(resolved);
  }

  /**
   * Parses a multipart request body as an async generator, yielding parts
   * one by one. File parts are truly streamed with backpressure via TransformStream.
   *
   * @throws {MultipartError} when the request is invalid or limits are exceeded.
   *
   * @example
   * ```ts
   * for await (const part of mp.parse(request)) {
   *   if (part.isFile) {
   *     const safeName = sanitizeFilename(part.filename) ?? 'unnamed';
   *     await part.saveTo(`./uploads/${safeName}`);
   *   } else {
   *     console.log(part.name, part.text());
   *   }
   * }
   * ```
   */
  public async *parse(request: Request): AsyncGenerator<MultipartPart, void, undefined> {
    const boundary = this.extractBoundaryFromRequest(request);
    const body = this.extractBody(request);

    const queue = new PartQueue();
    const callbacks = new StreamingCallbacks(queue);

    // Start the parser as a detached async task.
    // It runs concurrently with the consumer's iteration.
    // Errors are propagated via queue.fail() → iterator throws.
    parseMultipart(body, boundary, this.options, callbacks)
      .then(() => queue.finish())
      .catch((error) => { if (!queue.abandoned) queue.fail(error); });

    // Manual iteration instead of `yield* queue` to auto-drain unconsumed
    // file streams between yields. Without this, skipping a file part's
    // stream() causes a deadlock: the parser blocks on TransformStream
    // backpressure while the consumer waits for the next part.
    //
    // Drain MUST happen BEFORE `iter.next()` — `for await` would call
    // next() before the loop body, making it impossible to drain first.
    const iter = queue[Symbol.asyncIterator]();
    let previousFile: MultipartFileImpl | undefined;

    try {
      while (true) {
        if (previousFile !== undefined) {
          previousFile.drainIfUnconsumed();
        }

        const { value, done } = await iter.next();

        if (done) break;

        previousFile = value.isFile ? (value as MultipartFileImpl) : undefined;
        yield value;
      }
    } finally {
      if (previousFile !== undefined) {
        previousFile.drainIfUnconsumed();
      }

      await iter.return?.(undefined);
    }
  }

  /**
   * Parses all parts at once, collecting fields and files into Maps.
   *
   * Uses {@link BufferingCallbacks} for a fast path that avoids TransformStream
   * and PartQueue overhead entirely. File data is buffered directly in memory.
   *
   * @throws {MultipartError} when the request is invalid or limits are exceeded.
   *
   * @example
   * ```ts
   * const { fields, files } = await mp.parseAll(request);
   * ```
   */
  public async parseAll(request: Request): Promise<ParseAllResult> {
    const boundary = this.extractBoundaryFromRequest(request);
    const body = this.extractBody(request);

    const fields = new Map<string, string[]>();
    const files = new Map<string, MultipartFile[]>();
    const callbacks = new BufferingCallbacks(fields, files);

    await parseMultipart(body, boundary, this.options, callbacks);

    return { fields, files };
  }

  private extractBoundaryFromRequest(request: Request): string {
    const contentType = request.headers.get(HttpHeader.ContentType);
    const boundary = extractBoundary(contentType);

    if (isErr(boundary)) {
      throw new MultipartError(boundary.data);
    }

    return boundary;
  }

  private extractBody(request: Request): ReadableStream<Uint8Array> {
    if (request.body === null) {
      throw new MultipartError({
        reason: MultipartErrorReason.MissingBody,
        message: 'Request body is missing',
      });
    }

    return request.body;
  }
}
