/**
 * Reason why multipart parsing failed.
 */
export enum MultipartErrorReason {
  /** Request body is missing or null. */
  MissingBody = 'missing_body',
  /** Content-Type header is missing or not multipart/form-data. */
  InvalidContentType = 'invalid_content_type',
  /** Boundary parameter is missing from Content-Type. */
  MissingBoundary = 'missing_boundary',
  /** A file part exceeds maxFileSize. */
  FileTooLarge = 'file_too_large',
  /** A field part exceeds maxFieldSize. */
  FieldTooLarge = 'field_too_large',
  /** Number of file parts exceeds maxFiles. */
  TooManyFiles = 'too_many_files',
  /** Number of field parts exceeds maxFields. */
  TooManyFields = 'too_many_fields',
  /** Total body size exceeds maxTotalSize. */
  TotalSizeLimitExceeded = 'total_size_limit_exceeded',
  /** Part headers exceed maxHeaderSize. */
  HeaderTooLarge = 'header_too_large',
  /** Malformed part headers (missing Content-Disposition, etc.). */
  MalformedHeader = 'malformed_header',
  /** Stream ended before the final boundary was found. */
  UnexpectedEnd = 'unexpected_end',
  /** Invalid options provided. */
  InvalidOptions = 'invalid_options',
  /** File MIME type is not in the allowed list for its field name. */
  MimeTypeNotAllowed = 'mime_type_not_allowed',
  /** Total number of parts (fields + files) exceeds maxParts. */
  TooManyParts = 'too_many_parts',
}
