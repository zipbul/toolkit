import { Encoding } from './enums.ts';

export const DEFAULT_THRESHOLD = 1024;

export const DEFAULT_ENCODINGS: Encoding[] = [
  Encoding.Brotli,
  Encoding.Gzip,
];

export const DEFAULT_LEVELS: Record<Encoding, number> = {
  [Encoding.Brotli]: 4,
  [Encoding.Gzip]: 6,
  [Encoding.Deflate]: 6,
  [Encoding.Zstd]: 3,
};

const COMPRESSIBLE_PATTERN =
  /^text\/(?!event-stream\b)|^application\/(?:json|javascript|xml|xhtml\+xml|ecmascript|graphql|ld\+json|manifest\+json|vnd\.api\+json|.+\+xml|.+\+json)|^image\/svg\+xml/i;

export const DEFAULT_FILTER = (contentType: string): boolean =>
  COMPRESSIBLE_PATTERN.test(contentType);
