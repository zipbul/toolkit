import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import {
  DEFAULT_MAX_FIELD_SIZE,
  DEFAULT_MAX_FIELDS,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_HEADER_SIZE,
  DEFAULT_MAX_PARTS,
  DEFAULT_MAX_TOTAL_SIZE,
} from './constants';
import { MultipartErrorReason } from './enums';
import type { MultipartErrorData, MultipartOptions } from './interfaces';
import type { ResolvedMultipartOptions } from './types';

/**
 * Takes partial {@link MultipartOptions} and fills in every missing field
 * with a sensible default, returning fully populated {@link ResolvedMultipartOptions}.
 */
export function resolveMultipartOptions(options?: MultipartOptions): ResolvedMultipartOptions {
  return {
    maxFileSize: options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    maxFiles: options?.maxFiles ?? DEFAULT_MAX_FILES,
    maxFieldSize: options?.maxFieldSize ?? DEFAULT_MAX_FIELD_SIZE,
    maxFields: options?.maxFields ?? DEFAULT_MAX_FIELDS,
    maxHeaderSize: options?.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE,
    maxTotalSize: options?.maxTotalSize !== undefined ? options.maxTotalSize : DEFAULT_MAX_TOTAL_SIZE,
    maxParts: options?.maxParts ?? DEFAULT_MAX_PARTS,
    allowedMimeTypes: options?.allowedMimeTypes,
  };
}

/**
 * Validates a fully resolved {@link ResolvedMultipartOptions} object and returns
 * the first problem it finds, or `undefined` when everything looks good.
 */
export function validateMultipartOptions(resolved: ResolvedMultipartOptions): Result<void, MultipartErrorData> {
  if (!Number.isInteger(resolved.maxFileSize) || resolved.maxFileSize <= 0) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxFileSize must be a positive integer',
    });
  }

  if (!Number.isInteger(resolved.maxFiles) || resolved.maxFiles <= 0) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxFiles must be a positive integer',
    });
  }

  if (!Number.isInteger(resolved.maxFieldSize) || resolved.maxFieldSize <= 0) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxFieldSize must be a positive integer',
    });
  }

  if (!Number.isInteger(resolved.maxFields) || resolved.maxFields <= 0) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxFields must be a positive integer',
    });
  }

  if (!Number.isInteger(resolved.maxHeaderSize) || resolved.maxHeaderSize <= 0) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxHeaderSize must be a positive integer',
    });
  }

  if (resolved.maxTotalSize !== null && (!Number.isInteger(resolved.maxTotalSize) || resolved.maxTotalSize <= 0)) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxTotalSize must be a positive integer or null',
    });
  }

  // maxParts: Infinity is valid (no limit), but other non-integer values are not
  if (resolved.maxParts !== Infinity && (!Number.isInteger(resolved.maxParts) || resolved.maxParts <= 0)) {
    return err({
      reason: MultipartErrorReason.InvalidOptions,
      message: 'maxParts must be a positive integer or Infinity',
    });
  }

  if (resolved.allowedMimeTypes !== undefined) {
    for (const [fieldName, types] of Object.entries(resolved.allowedMimeTypes)) {
      if (!Array.isArray(types) || types.length === 0) {
        return err({
          reason: MultipartErrorReason.InvalidOptions,
          message: `allowedMimeTypes["${fieldName}"] must be a non-empty array of strings`,
        });
      }
    }
  }

  return undefined;
}
