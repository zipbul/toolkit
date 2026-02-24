import type { Result } from '@zipbul/result';
import type { RouterErrData } from '../types';
import type { ProcessorContext } from './context';

export interface ProcessorConfig {
  collapseSlashes?: boolean;
  ignoreTrailingSlash?: boolean;
  blockTraversal?: boolean;
  caseSensitive?: boolean;
  maxSegmentLength?: number;
  failFastOnBadEncoding?: boolean;
}

export type PipelineStep = (ctx: ProcessorContext) => Result<void, RouterErrData>;
