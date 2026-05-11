import type { CompressionErrorReason, Encoding } from './enums.ts';

export interface BreachOptions {
  maxPadding: number;
}

export interface CompressionOptions {
  encodings?: Encoding[];
  threshold?: number;
  filter?: (contentType: string) => boolean;
  level?: Partial<Record<Encoding, number>>;
  breach?: BreachOptions;
}

export interface CompressionErrorData {
  reason: CompressionErrorReason;
  message: string;
}

export class CompressionError extends Error {
  public readonly reason: CompressionErrorReason;

  constructor(data: CompressionErrorData) {
    super(data.message);
    this.name = 'CompressionError';
    this.reason = data.reason;
  }
}
