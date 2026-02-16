import type { ProcessorConfig } from './types';

export class ProcessorContext {
  public path: string;
  public segments: string[] = [];
  public segmentDecodeHints?: Uint8Array;
  public readonly config: ProcessorConfig;

  constructor(path: string, config: ProcessorConfig) {
    this.path = path;
    this.config = config;
  }
}
