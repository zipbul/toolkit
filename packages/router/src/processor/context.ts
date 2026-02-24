import type { ProcessorConfig } from './types';

export class ProcessorContext {
  public path: string;
  public segments: string[] = [];
  public segmentDecodeHints?: Uint8Array;
  public readonly config: ProcessorConfig;

  constructor(config: ProcessorConfig) {
    this.path = '';
    this.config = config;
  }

  reset(path: string): void {
    this.path = path;
    this.segments = [];
    this.segmentDecodeHints = undefined;
  }
}
