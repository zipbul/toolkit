import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { MultipartErrorReason } from '../enums';
import type { MultipartErrorData } from '../interfaces';

/**
 * Parsed Content-Disposition header fields.
 */
export interface DispositionInfo {
  name: string;
  filename: string | undefined;
}

/**
 * All parsed headers for a single multipart part.
 */
export interface PartHeaders {
  name: string;
  filename: string | undefined;
  contentType: string;
}

/**
 * Parses the raw header block of a multipart part.
 *
 * Extracts `name` and `filename` from Content-Disposition,
 * and Content-Type (defaults to 'text/plain' if absent).
 *
 * Supports both `\r\n` and bare `\n` line endings for robustness
 * against non-compliant clients.
 */
export function parsePartHeaders(headerBlock: string): Result<PartHeaders, MultipartErrorData> {
  let contentDisposition: string | undefined;
  let contentType = 'text/plain';
  let hasContentType = false;

  // Normalize bare \n to \r\n then split — handles non-compliant clients
  const normalized = headerBlock.replace(/\r?\n/g, '\r\n');
  const lines = normalized.split('\r\n');

  for (const line of lines) {
    if (line.length === 0) continue;

    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) continue;

    const headerName = line.slice(0, colonIndex).trim().toLowerCase();
    const headerValue = line.slice(colonIndex + 1).trim();

    if (headerName === 'content-disposition' && contentDisposition === undefined) {
      contentDisposition = headerValue;
    } else if (headerName === 'content-type' && !hasContentType) {
      contentType = headerValue;
      hasContentType = true;
    }
  }

  if (contentDisposition === undefined) {
    return err({
      reason: MultipartErrorReason.MalformedHeader,
      message: 'Missing Content-Disposition header in part',
    });
  }

  const disposition = parseContentDisposition(contentDisposition);

  if (disposition === undefined) {
    return err({
      reason: MultipartErrorReason.MalformedHeader,
      message: 'Missing "name" parameter in Content-Disposition',
    });
  }

  return {
    name: disposition.name,
    filename: disposition.filename,
    contentType,
  };
}

/**
 * Extracts `name` and `filename` parameters from a Content-Disposition value.
 *
 * Validates that the disposition type is `form-data` per RFC 7578.
 * Handles both quoted and unquoted values, including escaped quotes.
 * Strips null bytes from extracted values to prevent truncation attacks.
 */
function parseContentDisposition(value: string): DispositionInfo | undefined {
  // Validate directive type is form-data
  const trimmed = value.trim();

  if (!trimmed.toLowerCase().startsWith('form-data')) {
    return undefined;
  }

  const name = extractParam(trimmed, 'name');

  // Reject empty or missing name
  if (name === undefined || name.length === 0) {
    return undefined;
  }

  const filename = extractParam(trimmed, 'filename');

  return { name, filename };
}

// Pre-compiled patterns for Content-Disposition parameters.
// Only `name=` and `filename=` are extracted. The `filename*=` parameter
// (RFC 5987) is intentionally ignored per RFC 7578 §4.2, which states it
// "MUST NOT be used" with multipart/form-data. Parsing it would create an
// attack surface (see SicuraNext multipart parser bypass research).
// Supports escaped quotes within quoted values: name="file\"name"
const NAME_PATTERN = /(?:^|;\s*)name=("((?:[^"\\]|\\.)*)"|([^;\s]*))/i;
const FILENAME_PATTERN = /(?:^|;\s*)filename=("((?:[^"\\]|\\.)*)"|([^;\s]*))/i;

const PARAM_PATTERNS: Record<string, RegExp> = {
  name: NAME_PATTERN,
  filename: FILENAME_PATTERN,
};

/**
 * Extracts a named parameter value from a header value string.
 * Supports both quoted (`param="value"`) and unquoted (`param=value`) forms.
 * Handles escaped quotes within quoted values and strips null bytes.
 */
function extractParam(headerValue: string, paramName: string): string | undefined {
  const pattern = PARAM_PATTERNS[paramName];

  if (pattern === undefined) return undefined;

  const match = headerValue.match(pattern);

  if (match === null) {
    return undefined;
  }

  // match[2] is the quoted value (with escapes), match[3] is the unquoted value
  let value = match[2] ?? match[3];

  if (value === undefined) return undefined;

  // Unescape escaped characters within quoted values (e.g. \" → ")
  if (match[2] !== undefined) {
    value = value.replace(/\\(.)/g, '$1');
  }

  // Strip null bytes to prevent truncation attacks (e.g. "evil.php\0.jpg")
  value = value.replace(/\0/g, '');

  return value;
}
