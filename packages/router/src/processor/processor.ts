import type { Result } from '@zipbul/result';
import type { NormalizedPathSegments, RouterErrData } from '../types';
import type { ProcessorConfig, PipelineStep } from './types';

import { err, isErr } from '@zipbul/result';
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
  private readonly ctx: ProcessorContext;
  private readonly needsCaseCheck: boolean;

  constructor(config: ProcessorConfig) {
    this.config = config;
    this.pipeline = [];
    this.ctx = new ProcessorContext(config);
    this.needsCaseCheck = config.caseSensitive === false;

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

  normalize(path: string, stripQueryParam = true): Result<NormalizedPathSegments, RouterErrData> {
    // Fast path: clean path scan
    if (this.isCleanPath(path, stripQueryParam)) {
      return this.fastNormalize(path);
    }

    const ctx = this.ctx;

    ctx.reset(path);

    const startStepIndex = stripQueryParam ? 0 : 1;

    for (let i = startStepIndex; i < this.pipeline.length; i++) {
      const step = this.pipeline[i];

      if (!step) {
        continue;
      }

      const stepResult = step(ctx);

      if (isErr(stepResult)) {
        return stepResult;
      }
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

  /**
   * Single-pass scan to detect if path needs complex pipeline processing.
   * A "clean" path has no query string, no double slashes, no dot segments,
   * no percent-encoding, and (when case-insensitive) no uppercase letters.
   */
  private isCleanPath(path: string, stripQueryParam: boolean): boolean {
    const len = path.length;

    // Must start with '/'
    if (len === 0 || path.charCodeAt(0) !== 47) {
      return false;
    }

    const checkCase = this.needsCaseCheck;
    let prevSlash = true; // starts after '/'
    const maxLen = this.config.maxSegmentLength ?? 256;
    let segLen = 0;

    for (let i = 1; i < len; i++) {
      const ch = path.charCodeAt(i);

      if (ch === 47) { // '/'
        if (prevSlash) {
          return false; // double slash
        }

        prevSlash = true;
        segLen = 0;

        continue;
      }

      prevSlash = false;
      segLen++;

      if (segLen > maxLen) {
        return false;
      }

      if (stripQueryParam && ch === 63) { // '?'
        return false;
      }

      if (ch === 37) { // '%'
        return false;
      }

      if (ch === 46) { // '.'
        // dot segment: path starts with /. or /.. followed by / or end
        if (segLen === 1) {
          // could be '.' or '..' — check ahead
          const next = i + 1 < len ? path.charCodeAt(i + 1) : -1;

          if (next === 47 || next === -1) {
            return false; // single dot segment
          }

          if (next === 46) { // '..'
            const afterDot = i + 2 < len ? path.charCodeAt(i + 2) : -1;

            if (afterDot === 47 || afterDot === -1) {
              return false; // double dot segment
            }
          }
        }
      }

      if (checkCase && ch >= 65 && ch <= 90) { // A-Z
        return false;
      }
    }

    return true;
  }

  /**
   * Fast normalization for clean paths — single split, no pipeline.
   */
  private fastNormalize(path: string): Result<NormalizedPathSegments, RouterErrData> {
    // leading slash already confirmed; split after it
    const body = path.length > 1 ? path.slice(1) : '';

    let segments: string[];

    if (body === '') {
      segments = [];
    } else {
      segments = body.split('/');
    }

    // Handle trailing slash
    if (this.config.ignoreTrailingSlash !== false && segments.length > 0 && segments[segments.length - 1] === '') {
      segments.pop();
    }

    // Validate segment length
    const maxLen = this.config.maxSegmentLength ?? 256;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;

      if (seg.length > maxLen) {
        return err<RouterErrData>({
          kind: 'segment-limit',
          message: `Segment length exceeds limit: ${seg.substring(0, 20)}...`,
          segment: seg.substring(0, 40),
          suggestion: `Shorten the path segment to ${maxLen} characters or fewer, or increase maxSegmentLength in RouterOptions.`,
        });
      }
    }

    // No percent-encoding in clean path → all hints are 0
    const segmentDecodeHints = new Uint8Array(segments.length);

    const normalized = segments.length > 0 ? '/' + segments.join('/') : '/';

    return {
      normalized,
      segments,
      segmentDecodeHints,
    };
  }

  /**
   * build() 시점에 호출. 활성화된 step만 인라인한 단일 정규화 클로저 생성.
   * PipelineStep[] 순회 + 간접 호출 오버헤드를 제거한다.
   * clean path에서 Uint8Array 할당을 생략한다 (4-4).
   *
   * 반환된 함수는 항상 stripQueryParam=true로 동작한다 (match 전용).
   * Processor 인스턴스 해제 후에도 독립적으로 사용 가능하다.
   */
  buildNormalizer(): (path: string) => Result<NormalizedPathSegments, RouterErrData> {
    const needsCaseCheck = this.needsCaseCheck;
    const collapseSlashesEnabled = this.config.collapseSlashes === true;
    const ignoreTrailingSlash = this.config.ignoreTrailingSlash !== false;
    const blockTraversal = this.config.blockTraversal === true;
    const maxSegLen = this.config.maxSegmentLength ?? 256;

    // Dirty path용 재사용 컨텍스트
    const ctx = new ProcessorContext(this.config);

    return (path: string): Result<NormalizedPathSegments, RouterErrData> => {
      // ── Clean path fast path ──
      const len = path.length;

      if (len > 0 && path.charCodeAt(0) === 47) {
        let clean = true;
        let prevSlash = true;
        let segLen = 0;

        for (let i = 1; i < len; i++) {
          const ch = path.charCodeAt(i);

          if (ch === 47) {
            if (prevSlash) { clean = false; break; }

            prevSlash = true;
            segLen = 0;

            continue;
          }

          prevSlash = false;
          segLen++;

          if (segLen > maxSegLen || ch === 63 || ch === 37) { clean = false; break; }

          if (ch === 46 && segLen === 1) {
            const next = i + 1 < len ? path.charCodeAt(i + 1) : -1;

            if (next === 47 || next === -1) { clean = false; break; }

            if (next === 46) {
              const afterDot = i + 2 < len ? path.charCodeAt(i + 2) : -1;

              if (afterDot === 47 || afterDot === -1) { clean = false; break; }
            }
          }

          if (needsCaseCheck && ch >= 65 && ch <= 90) { clean = false; break; }
        }

        if (clean) {
          const body = len > 1 ? path.slice(1) : '';
          const segments = body === '' ? [] : body.split('/');

          if (ignoreTrailingSlash && segments.length > 0 && segments[segments.length - 1] === '') {
            segments.pop();
          }

          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]!;

            if (seg.length > maxSegLen) {
              return err<RouterErrData>({
                kind: 'segment-limit',
                message: `Segment length exceeds limit: ${seg.substring(0, 20)}...`,
                segment: seg.substring(0, 40),
                suggestion: `Shorten the path segment to ${maxSegLen} characters or fewer, or increase maxSegmentLength in RouterOptions.`,
              });
            }
          }

          const normalized = segments.length > 0 ? '/' + segments.join('/') : '/';

          // Clean path — no % encoding → hints undefined (할당 생략, 4-4)
          return { normalized, segments };
        }
      }

      // ── Dirty path: 인라인 파이프라인 (배열 순회 없음) ──
      ctx.reset(path);

      let r = stripQuery(ctx);

      if (isErr(r)) {
        return r;
      }

      r = removeLeadingSlash(ctx);

      if (isErr(r)) {
        return r;
      }

      r = splitPath(ctx);

      if (isErr(r)) {
        return r;
      }

      if (blockTraversal) {
        r = resolveDotSegments(ctx);

        if (isErr(r)) {
          return r;
        }
      }

      if (collapseSlashesEnabled) {
        r = collapseSlashes(ctx);

        if (isErr(r)) {
          return r;
        }
      } else if (ignoreTrailingSlash) {
        r = handleTrailingSlashOptions(ctx);

        if (isErr(r)) {
          return r;
        }
      }

      if (needsCaseCheck) {
        r = toLowerCase(ctx);

        if (isErr(r)) {
          return r;
        }
      }

      r = validateSegments(ctx);

      if (isErr(r)) {
        return r;
      }

      const result: NormalizedPathSegments = {
        normalized: '/' + ctx.segments.join('/'),
        segments: ctx.segments,
      };

      if (ctx.segmentDecodeHints !== undefined) {
        result.segmentDecodeHints = ctx.segmentDecodeHints;
      }

      return result;
    };
  }
}
