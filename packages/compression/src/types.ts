import type { Encoding } from './enums.ts';

export type ResolvedCompressionOptions = {
  encodings: Encoding[];
  threshold: number;
  filter: (contentType: string) => boolean;
  level: Record<Encoding, number>;
};

export type BufferCompressFn = (data: Uint8Array, level: number) => Uint8Array;
