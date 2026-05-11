export enum Encoding {
  Brotli = 'br',
  Zstd = 'zstd',
  Gzip = 'gzip',
  Deflate = 'deflate',
}

export enum CompressionErrorReason {
  InvalidThreshold = 'invalid_threshold',
  InvalidEncodings = 'invalid_encodings',
  InvalidLevel = 'invalid_level',
  EmptyEncodings = 'empty_encodings',
  InvalidBreach = 'invalid_breach',
}
