import type { NormalizedPathSegments } from '../types';
import type { ProcessorConfig, PipelineStep } from './types';

import { ProcessorContext } from './context';
import { toLowerCase } from './steps/case-sensitivity';
import { resolveDotSegments } from './steps/dot-segments';
import { removeLeadingSlash } from './steps/remove-leading-slash';
import { collapseSlashes, handleTrailingSlashOptions } from './steps/slashes';
import { splitPath } from './steps/split';
import { stripQuery } from './steps/strip-query';
import { validateSegments } from './steps/validation';

export class Processor {
  private readonly config: ProcessorConfig;
  private readonly pipeline: PipelineStep[];

  constructor(config: ProcessorConfig) {
    this.config = config;
    this.pipeline = [];

    this.pipeline.push(stripQuery);
    this.pipeline.push(removeLeadingSlash);
    this.pipeline.push(splitPath);

    if (config.blockTraversal === true) {
      this.pipeline.push(resolveDotSegments);
    }

    if (config.collapseSlashes === true) {
      this.pipeline.push(collapseSlashes);
    } else if (config.ignoreTrailingSlash === true) {
      this.pipeline.push(handleTrailingSlashOptions);
    }

    if (config.caseSensitive === false) {
      this.pipeline.push(toLowerCase);
    }

    this.pipeline.push(validateSegments);
  }

  normalize(path: string, stripQueryParam = true): NormalizedPathSegments {
    const ctx = new ProcessorContext(path, this.config);
    const startStepIndex = stripQueryParam ? 0 : 1;

    for (let i = startStepIndex; i < this.pipeline.length; i++) {
      const step = this.pipeline[i];

      if (!step) {
        continue;
      }

      step(ctx);
    }

    const normalized: NormalizedPathSegments = {
      normalized: '/' + ctx.segments.join('/'),
      segments: ctx.segments,
    };

    if (ctx.segmentDecodeHints !== undefined) {
      normalized.segmentDecodeHints = ctx.segmentDecodeHints;
    }

    return normalized;
  }
}
