import { isErr } from '@zipbul/result';

import { CRLF, CRLFCRLF, EMPTY_BUF, noop } from '../constants';
import { MultipartErrorReason } from '../enums';
import { MultipartError } from '../interfaces';
import type { AllowedMimeTypes } from '../interfaces';
import type { ResolvedMultipartOptions } from '../types';

import type { FileWriter, ParserCallbacks } from './callbacks';
import type { PartHeaders } from './header-parser';
import { parsePartHeaders } from './header-parser';


/**
 * FSM states for the multipart parser.
 *
 * Transitions:
 *   Start → AfterBoundary → Header → Body → AfterBoundary → …
 *                  ↓                              ↓
 *                Done                           Done
 */
enum ParserState {
  Start = 0,
  AfterBoundary = 1,
  Header = 2,
  Body = 3,
  Done = 4,
}

/**
 * Maximum number of unexpected bytes to skip in the AfterBoundary state
 * before throwing. RFC 2046 allows optional LWSP (transport padding) after
 * the boundary, but we cap it to prevent CPU-based DoS on malformed input.
 */
const MAX_AFTER_BOUNDARY_SKIP = 128;

/**
 * Streaming multipart parser that emits parts via {@link ParserCallbacks}.
 *
 * Runs as an independent async task. For file parts, calls
 * `callbacks.onFileStart()` to obtain a {@link FileWriter} and writes
 * chunks into it. For field parts, buffers the body completely then
 * calls `callbacks.onField()`.
 *
 * Two callback implementations provide different fast paths:
 * - `BufferingCallbacks` — sync, no TransformStream (for `parseAll`)
 * - `StreamingCallbacks` — TransformStream + PartQueue (for `parse`)
 */
export async function parseMultipart(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  options: ResolvedMultipartOptions,
  callbacks: ParserCallbacks,
): Promise<void> {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const boundaryLen = boundaryBuffer.length;
  const delimBuffer = Buffer.concat([CRLF, boundaryBuffer]);

  let state: ParserState = ParserState.Start;
  let remainder: Buffer = EMPTY_BUF;
  let headerBuf: Buffer = EMPTY_BUF;

  // Body chunks are accumulated in an array for field parts.
  // For file parts, chunks are written directly to the FileWriter.
  let bodyChunks: Buffer[] = [];
  let bodySize = 0;

  let currentHeaders: PartHeaders | undefined;
  let fileCount = 0;
  let fieldCount = 0;
  let partCount = 0;
  let totalBytesRead = 0;
  let afterBoundarySkipped = 0;
  let receivedAnyData = false;

  // Active file writer — set when we're in Body state for a file part
  let fileWriter: FileWriter | undefined;
  let isCurrentPartFile = false;

  try {
    for await (const chunk of body) {
      if (callbacks.abandoned) {
        break;
      }

      const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      if (chunkBuf.length > 0) {
        receivedAnyData = true;
      }

      totalBytesRead += chunkBuf.length;

      if (options.maxTotalSize !== null && totalBytesRead > options.maxTotalSize) {
        throw new MultipartError(
          {
            reason: MultipartErrorReason.TotalSizeLimitExceeded,
            message: `Total body size (${totalBytesRead} bytes) exceeds limit of ${options.maxTotalSize} bytes`,
          },
          { context: { bytesRead: totalBytesRead } },
        );
      }

      // Prepend any leftover from previous chunk
      let buf: Buffer = remainder.length > 0 ? Buffer.concat([remainder, chunkBuf]) : chunkBuf;
      remainder = EMPTY_BUF;

      while (buf.length > 0) {
        if ((state as ParserState) === ParserState.Done) {
          break;
        }

        if (callbacks.abandoned) {
          break;
        }

        if (state === ParserState.Start) {
          const idx = buf.indexOf(boundaryBuffer);

          if (idx === -1) {
            remainder = keepTail(buf, boundaryLen);
            break;
          }

          buf = buf.subarray(idx + boundaryLen) as Buffer;
          state = ParserState.AfterBoundary;
          afterBoundarySkipped = 0;
          continue;
        }

        if (state === ParserState.AfterBoundary) {
          if (buf.length < 2) {
            remainder = buf;
            break;
          }

          // `--` after boundary = final boundary
          if (buf[0] === 0x2d && buf[1] === 0x2d) {
            state = ParserState.Done;
            break;
          }

          // CRLF after boundary = start of headers
          if (buf[0] === 0x0d && buf[1] === 0x0a) {
            buf = buf.subarray(2) as Buffer;
            state = ParserState.Header;
            headerBuf = EMPTY_BUF;
            afterBoundarySkipped = 0;
            continue;
          }

          // Unexpected bytes — skip with a safety limit
          afterBoundarySkipped++;

          if (afterBoundarySkipped > MAX_AFTER_BOUNDARY_SKIP) {
            throw new MultipartError({
              reason: MultipartErrorReason.MalformedHeader,
              message: `Exceeded ${MAX_AFTER_BOUNDARY_SKIP} bytes of unexpected data after boundary`,
            });
          }

          buf = buf.subarray(1) as Buffer;
          continue;
        }

        if (state === ParserState.Header) {
          // Combine accumulated headers with current buffer before searching
          const combined: Buffer = headerBuf.length > 0 ? Buffer.concat([headerBuf, buf]) : buf;
          const headerEndIdx = combined.indexOf(CRLFCRLF);

          if (headerEndIdx === -1) {
            headerBuf = combined;

            if (headerBuf.length > options.maxHeaderSize) {
              throw new MultipartError({
                reason: MultipartErrorReason.HeaderTooLarge,
                message: `Part headers (${headerBuf.length} bytes) exceed limit of ${options.maxHeaderSize} bytes`,
              });
            }

            break;
          }

          const headerEnd = combined.subarray(0, headerEndIdx);

          if (headerEnd.length > options.maxHeaderSize) {
            throw new MultipartError({
              reason: MultipartErrorReason.HeaderTooLarge,
              message: `Part headers (${headerEnd.length} bytes) exceed limit of ${options.maxHeaderSize} bytes`,
            });
          }

          const parsedHeaders = parsePartHeaders(headerEnd.toString('utf-8'));

          if (isErr(parsedHeaders)) {
            throw new MultipartError(parsedHeaders.data);
          }

          currentHeaders = parsedHeaders;
          isCurrentPartFile = currentHeaders.filename !== undefined;
          buf = combined.subarray(headerEndIdx + CRLFCRLF.length) as Buffer;
          headerBuf = EMPTY_BUF;
          state = ParserState.Body;
          bodyChunks = [];
          bodySize = 0;

          // For file parts, obtain a FileWriter via callbacks
          if (isCurrentPartFile) {
            // Check count limits BEFORE setting up the writer
            fileCount++;

            if (fileCount > options.maxFiles) {
              throw new MultipartError(
                {
                  reason: MultipartErrorReason.TooManyFiles,
                  message: `Number of files (${fileCount}) exceeds limit of ${options.maxFiles}`,
                },
                { context: { partIndex: partCount, fieldName: currentHeaders.name, bytesRead: totalBytesRead } },
              );
            }

            partCount++;

            if (Number.isFinite(options.maxParts) && partCount > options.maxParts) {
              throw new MultipartError(
                {
                  reason: MultipartErrorReason.TooManyParts,
                  message: `Number of parts (${partCount}) exceeds limit of ${options.maxParts}`,
                },
                { context: { partIndex: partCount - 1, bytesRead: totalBytesRead } },
              );
            }

            // Check allowedMimeTypes
            if (options.allowedMimeTypes !== undefined) {
              checkAllowedMimeType(
                currentHeaders.name,
                currentHeaders.contentType,
                options.allowedMimeTypes,
                partCount - 1,
                totalBytesRead,
              );
            }

            fileWriter = callbacks.onFileStart(
              currentHeaders.name,
              currentHeaders.filename!,
              currentHeaders.contentType,
            );
          }

          continue;
        }

        if (state === ParserState.Body) {
          const delimIdx = buf.indexOf(delimBuffer);

          if (delimIdx === -1) {
            // Keep a tail equal to delimiter length for cross-chunk boundary detection
            const safeLen = buf.length - delimBuffer.length;

            if (safeLen > 0) {
              const safe = buf.subarray(0, safeLen) as Buffer;

              if (currentHeaders !== undefined) {
                checkBodyLimitProjected(bodySize + safe.length, currentHeaders, options);
              }

              if (isCurrentPartFile && fileWriter !== undefined) {
                // Write chunk to FileWriter (backpressure happens here for streaming)
                bodySize += safe.length;
                await fileWriter.write(Buffer.from(safe));
              } else {
                bodyChunks.push(safe);
                bodySize += safe.length;
              }

              remainder = buf.subarray(safeLen) as Buffer;
            } else {
              remainder = buf;
            }

            break;
          }

          // Found boundary — complete this part
          const bodyChunk = buf.subarray(0, delimIdx);
          const projectedSize = bodySize + bodyChunk.length;

          if (currentHeaders === undefined) {
            throw new MultipartError({
              reason: MultipartErrorReason.MalformedHeader,
              message: 'Missing headers for part body',
            });
          }

          const headers = currentHeaders;

          if (isCurrentPartFile) {
            // File part: write final chunk and close writer
            checkBodyLimitProjected(projectedSize, headers, options);

            if (fileWriter !== undefined) {
              if (bodyChunk.length > 0) {
                await fileWriter.write(Buffer.from(bodyChunk));
              }

              await fileWriter.close();
              fileWriter = undefined;
            }
          } else {
            // Field part: buffer and push via callbacks
            fieldCount++;

            if (fieldCount > options.maxFields) {
              throw new MultipartError(
                {
                  reason: MultipartErrorReason.TooManyFields,
                  message: `Number of fields (${fieldCount}) exceeds limit of ${options.maxFields}`,
                },
                { context: { partIndex: partCount, fieldName: headers.name, bytesRead: totalBytesRead } },
              );
            }

            partCount++;

            if (Number.isFinite(options.maxParts) && partCount > options.maxParts) {
              throw new MultipartError(
                {
                  reason: MultipartErrorReason.TooManyParts,
                  message: `Number of parts (${partCount}) exceeds limit of ${options.maxParts}`,
                },
                { context: { partIndex: partCount - 1, bytesRead: totalBytesRead } },
              );
            }

            // Check size limit BEFORE allocation
            checkBodyLimitProjected(projectedSize, headers, options);

            // Single concat at part completion — O(n) total copy work
            let completeBody: Buffer;

            if (bodyChunks.length === 0 && bodyChunk.length === 0) {
              completeBody = EMPTY_BUF;
            } else if (bodyChunks.length === 0) {
              completeBody = Buffer.from(bodyChunk) as Buffer;
            } else {
              bodyChunks.push(bodyChunk as Buffer);
              completeBody = Buffer.concat(bodyChunks) as Buffer;
            }

            callbacks.onField(headers.name, headers.contentType, completeBody);
          }

          buf = buf.subarray(delimIdx + delimBuffer.length) as Buffer;
          state = ParserState.AfterBoundary;
          afterBoundarySkipped = 0;
          bodyChunks = [];
          bodySize = 0;
          currentHeaders = undefined;
          isCurrentPartFile = false;
          continue;
        }
      }

      if (state === ParserState.Done) {
        break;
      }
    }
  } catch (error) {
    // Abort any in-progress file writer
    if (fileWriter !== undefined) {
      fileWriter.abort(error);
      fileWriter = undefined;
    }

    // Ensure the stream reader is released on any error
    try { body.cancel().catch(noop); } catch { /* already released */ }

    // If consumer has abandoned, swallow the error
    if (callbacks.abandoned) {
      return;
    }

    // Re-throw — callers handle error propagation differently:
    // - BufferingCallbacks: thrown directly to parseAll() caller
    // - StreamingCallbacks: caught by .catch() bridge → queue.fail()
    if (error instanceof MultipartError) {
      throw error;
    }

    throw new MultipartError(
      {
        reason: MultipartErrorReason.UnexpectedEnd,
        message: error instanceof Error ? error.message : 'Stream read failed',
      },
      { cause: error },
    );
  }

  // If consumer abandoned, clean up
  if (callbacks.abandoned) {
    if (fileWriter !== undefined) {
      fileWriter.abort();
      fileWriter = undefined;
    }

    try { body.cancel().catch(noop); } catch { /* ignore */ }

    return;
  }

  // Stream ended without reaching the final boundary
  if ((state as ParserState) === ParserState.Start && receivedAnyData) {
    // fileWriter is never set in Start state — no abort needed
    throw new MultipartError({
      reason: MultipartErrorReason.UnexpectedEnd,
      message: 'Stream contained data but no multipart boundary was found',
    });
  }

  if ((state as ParserState) !== ParserState.Done && (state as ParserState) !== ParserState.Start) {
    const error = new MultipartError({
      reason: MultipartErrorReason.UnexpectedEnd,
      message: 'Stream ended before the final boundary was found (truncated body)',
    });

    if (fileWriter !== undefined) {
      fileWriter.abort(error);
      fileWriter = undefined;
    }

    throw error;
  }
}

function keepTail(buf: Buffer, maxLen: number): Buffer {
  if (buf.length <= maxLen) {
    return buf;
  }

  return buf.subarray(buf.length - maxLen) as Buffer;
}

/**
 * Checks projected body size BEFORE allocation to prevent memory spikes.
 */
function checkBodyLimitProjected(
  projectedSize: number,
  headers: PartHeaders,
  options: ResolvedMultipartOptions,
): void {
  const isFile = headers.filename !== undefined;

  if (isFile && projectedSize > options.maxFileSize) {
    throw new MultipartError({
      reason: MultipartErrorReason.FileTooLarge,
      message: `File "${headers.filename}" (${projectedSize} bytes) exceeds limit of ${options.maxFileSize} bytes`,
    });
  }

  if (!isFile && projectedSize > options.maxFieldSize) {
    throw new MultipartError({
      reason: MultipartErrorReason.FieldTooLarge,
      message: `Field "${headers.name}" (${projectedSize} bytes) exceeds limit of ${options.maxFieldSize} bytes`,
    });
  }
}

/**
 * Checks whether a file's Content-Type is allowed for its field name.
 */
function checkAllowedMimeType(
  fieldName: string,
  contentType: string,
  allowed: AllowedMimeTypes,
  partIndex: number,
  bytesRead: number,
): void {
  const allowedTypes = allowed[fieldName];

  if (allowedTypes === undefined) {
    // No restriction for this field name
    return;
  }

  const lower = contentType.split(';', 1)[0]!.trim().toLowerCase();

  if (!allowedTypes.some((t) => lower === t.split(';', 1)[0]!.trim().toLowerCase())) {
    throw new MultipartError(
      {
        reason: MultipartErrorReason.MimeTypeNotAllowed,
        message: `File field "${fieldName}" has MIME type "${contentType}" which is not in the allowed list: ${allowedTypes.join(', ')}`,
      },
      { context: { partIndex, fieldName, bytesRead } },
    );
  }
}
