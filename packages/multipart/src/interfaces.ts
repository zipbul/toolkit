import type { MultipartErrorReason } from './enums';

// ── Error ───────────────────────────────────────────────────────────

/**
 * Error data payload used by {@link MultipartError}.
 */
export interface MultipartErrorData {
  reason: MultipartErrorReason;
  message: string;
}

/**
 * Additional context attached to parsing errors.
 */
export interface MultipartErrorContext {
  /** Zero-based index of the part where the error occurred. */
  partIndex?: number;
  /** The field name of the part, if known. */
  fieldName?: string;
  /** Total bytes read from the stream at the time of the error. */
  bytesRead?: number;
}

/**
 * Thrown by {@link Multipart.create} on invalid options, or during parsing
 * when a limit is exceeded or the input is malformed.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 */
export class MultipartError extends Error {
  /** The machine-readable reason code for this error. */
  public readonly reason: MultipartErrorReason;
  /** Additional context about where the error occurred, if available. */
  public readonly context?: MultipartErrorContext;

  constructor(data: MultipartErrorData, options?: { cause?: unknown; context?: MultipartErrorContext }) {
    super(data.message, options);
    this.name = 'MultipartError';
    this.reason = data.reason;
    this.context = options?.context;
  }
}

// ── Part (discriminated union) ──────────────────────────────────────

/**
 * A parsed multipart field (non-file) part.
 * All body accessors are synchronous since fields are buffered in memory.
 */
export interface MultipartField {
  /** The field name from Content-Disposition. */
  name: string;
  /** Always `undefined` for field parts. */
  filename: undefined;
  /** The Content-Type of the part (defaults to 'text/plain'). */
  contentType: string;
  /** Always `false` for field parts. */
  isFile: false;
  /** Returns the field body decoded as a UTF-8 string (sync). */
  text(): string;
  /** Returns the field body as raw bytes (sync). */
  bytes(): Uint8Array;
}

/**
 * A parsed multipart file part.
 * Supports true streaming with backpressure via TransformStream.
 */
export interface MultipartFile {
  /** The field name from Content-Disposition. */
  name: string;
  /**
   * The original filename from Content-Disposition.
   *
   * **WARNING:** This value is NOT sanitized. It may contain path traversal
   * sequences like `../../etc/passwd` or backslash paths like `C:\Users\file.txt`.
   * Use {@link sanitizeFilename} before using in any filesystem operation.
   *
   * The `filename*=` parameter (RFC 5987) is intentionally ignored per RFC 7578
   * Section 4.2, which states it "MUST NOT be used" with multipart/form-data.
   */
  filename: string;
  /** The Content-Type of the part. */
  contentType: string;
  /** Always `true` for file parts. */
  isFile: true;
  /** Returns a ReadableStream of the file body with true backpressure. */
  stream(): ReadableStream<Uint8Array>;
  /** Reads the entire file stream and returns it as a Uint8Array. */
  bytes(): Promise<Uint8Array>;
  /** Reads the entire file stream and decodes it as a UTF-8 string. */
  text(): Promise<string>;
  /** Reads the entire file stream and returns it as an ArrayBuffer. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Writes the file to disk using Bun.write. Returns bytes written. */
  saveTo(path: string): Promise<number>;
}

/**
 * A single parsed multipart part — either a field or a file.
 * Use `part.isFile` to discriminate.
 */
export type MultipartPart = MultipartField | MultipartFile;

// ── Options ─────────────────────────────────────────────────────────

/**
 * Per-field MIME type allowlist.
 * Keys are field names, values are arrays of allowed MIME types.
 */
export type AllowedMimeTypes = Record<string, string[]>;

/**
 * Configuration for the {@link Multipart} parser.
 */
export interface MultipartOptions {
  /**
   * Maximum size of a single file part in bytes.
   * @defaultValue `10 * 1024 * 1024` (10 MiB)
   */
  maxFileSize?: number;
  /**
   * Maximum number of file parts allowed.
   * @defaultValue `10`
   */
  maxFiles?: number;
  /**
   * Maximum size of a single field part in bytes.
   * @defaultValue `1 * 1024 * 1024` (1 MiB)
   */
  maxFieldSize?: number;
  /**
   * Maximum number of field parts allowed.
   * @defaultValue `100`
   */
  maxFields?: number;
  /**
   * Maximum size of part headers in bytes.
   * @defaultValue `8 * 1024` (8 KiB)
   */
  maxHeaderSize?: number;
  /**
   * Maximum total body size in bytes. Set to `null` to disable.
   * @defaultValue `50 * 1024 * 1024` (50 MiB)
   */
  maxTotalSize?: number | null;
  /**
   * Maximum total number of parts (fields + files).
   * @defaultValue `Infinity` (no limit)
   */
  maxParts?: number;
  /**
   * Per-field MIME type allowlist for file parts.
   * When specified, file parts whose Content-Type is not in the list are rejected.
   * @defaultValue `undefined` (no restriction)
   */
  allowedMimeTypes?: AllowedMimeTypes;
}
