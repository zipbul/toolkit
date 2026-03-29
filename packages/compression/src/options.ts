import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import { CompressionErrorReason, Encoding } from './enums.ts';
import {
  DEFAULT_ENCODINGS,
  DEFAULT_FILTER,
  DEFAULT_LEVELS,
  DEFAULT_THRESHOLD,
} from './constants.ts';
import type { BreachOptions, CompressionErrorData, CompressionOptions } from './interfaces.ts';
import type { ResolvedCompressionOptions } from './types.ts';

const VALID_ENCODINGS = new Set<string>(Object.values(Encoding));

const LEVEL_RANGES: Record<Encoding, { min: number; max: number }> = {
  [Encoding.Gzip]: { min: 1, max: 9 },
  [Encoding.Deflate]: { min: 1, max: 9 },
  [Encoding.Brotli]: { min: 0, max: 11 },
  [Encoding.Zstd]: { min: 1, max: 19 },
};

/** Encodings with safe format-level padding for BREACH mitigation. */
export const BREACH_SAFE_ENCODINGS = new Set<Encoding>([Encoding.Gzip, Encoding.Zstd]);

export function resolveCompressionOptions(
  options?: CompressionOptions,
): ResolvedCompressionOptions {
  return {
    encodings: options?.encodings ?? DEFAULT_ENCODINGS,
    threshold: options?.threshold ?? DEFAULT_THRESHOLD,
    filter: options?.filter ?? DEFAULT_FILTER,
    level: { ...DEFAULT_LEVELS, ...options?.level },
  };
}

export function validateCompressionOptions(
  resolved: ResolvedCompressionOptions,
  breach?: BreachOptions,
): Result<void, CompressionErrorData> {
  if (resolved.encodings.length === 0) {
    return err<CompressionErrorData>({
      reason: CompressionErrorReason.EmptyEncodings,
      message: 'encodings must not be empty',
    });
  }

  for (const encoding of resolved.encodings) {
    if (!VALID_ENCODINGS.has(encoding)) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidEncodings,
        message: `unknown encoding: ${encoding}`,
      });
    }
  }

  if (!Number.isFinite(resolved.threshold) || resolved.threshold < 0) {
    return err<CompressionErrorData>({
      reason: CompressionErrorReason.InvalidThreshold,
      message: 'threshold must be a non-negative finite number',
    });
  }

  for (const encoding of Object.values(Encoding)) {
    const level = resolved.level[encoding];
    if (level === undefined) continue;

    const range = LEVEL_RANGES[encoding];
    if (!Number.isInteger(level) || level < range.min || level > range.max) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidLevel,
        message: `${encoding} level must be an integer between ${range.min} and ${range.max}, got ${level}`,
      });
    }
  }

  if (breach !== undefined) {
    if (!Number.isInteger(breach.maxPadding) || breach.maxPadding < 1 || breach.maxPadding > 4096) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidBreach,
        message: 'breach.maxPadding must be an integer between 1 and 4096',
      });
    }

    const hasSafeEncoding = resolved.encodings.some((e) => BREACH_SAFE_ENCODINGS.has(e));
    if (!hasSafeEncoding) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidBreach,
        message: 'breach requires at least one BREACH-safe encoding (gzip or zstd)',
      });
    }
  }

  return undefined;
}
