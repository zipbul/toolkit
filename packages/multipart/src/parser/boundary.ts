import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { MultipartErrorReason } from '../enums';
import type { MultipartErrorData } from '../interfaces';

/**
 * Maximum boundary length per RFC 2046 Section 5.1.1.
 */
const MAX_BOUNDARY_LENGTH = 70;

/**
 * Extracts the boundary string from a Content-Type header value.
 *
 * Expected format: `multipart/form-data; boundary=----WebKitFormBoundary...`
 *
 * @returns The boundary string, or an Err if the header is missing/invalid.
 */
export function extractBoundary(contentType: string | null): Result<string, MultipartErrorData> {
  if (contentType === null || contentType.length === 0) {
    return err({
      reason: MultipartErrorReason.InvalidContentType,
      message: 'Content-Type header is missing',
    });
  }

  const lower = contentType.toLowerCase();

  if (!lower.startsWith('multipart/form-data')) {
    return err({
      reason: MultipartErrorReason.InvalidContentType,
      message: `Expected multipart/form-data, got "${contentType}"`,
    });
  }

  // Match quoted (`boundary="..."`) or unquoted (`boundary=...`) forms
  const boundaryMatch = contentType.match(/;\s*boundary=(?:"([^"]*)"|([^\s;]+))/i);

  if (boundaryMatch === null) {
    return err({
      reason: MultipartErrorReason.MissingBoundary,
      message: 'Boundary parameter is missing from Content-Type',
    });
  }

  const boundary = boundaryMatch[1] ?? boundaryMatch[2];

  if (boundary === undefined || boundary.length === 0) {
    return err({
      reason: MultipartErrorReason.MissingBoundary,
      message: 'Boundary parameter is empty',
    });
  }

  if (boundary.length > MAX_BOUNDARY_LENGTH) {
    return err({
      reason: MultipartErrorReason.MissingBoundary,
      message: `Boundary length (${boundary.length}) exceeds maximum of ${MAX_BOUNDARY_LENGTH} characters (RFC 2046)`,
    });
  }

  return boundary;
}
