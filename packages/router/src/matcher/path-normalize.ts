/**
 * Single source for the path-normalization steps shared by the codegen-emitted
 * matchImpl and the cold-path `allowedMethods()` lookup. Each emitter returns
 * a JS string that mutates `sp` (or returns early through `bailReturn`).
 *
 * The codegen splits these stages around the static lookup so static cache
 * hits skip the segment-length scan; the cold-path helper concatenates them
 * all upfront. Both paths consume the *same* emit strings — no parallel TS
 * implementation can drift.
 */

export interface NormalizeCfg {
  /** Path-length guard (truthy when maxPathLen is finite). */
  checkPathLen: boolean;
  maxPathLen: number;
  /** Trim a single trailing slash on paths longer than `/`. */
  trimSlash: boolean;
  /** Apply ASCII/locale-folded `toLowerCase()`. */
  lowerCase: boolean;
  /** Per-segment length guard (truthy when maxSegLen is finite). */
  checkSegLen: boolean;
  maxSegLen: number;
}

/** Initial path-length guard. Emits nothing when not configured. */
export function emitPathLenCheck(cfg: NormalizeCfg, inVar: string, bailReturn: string): string {
  if (!cfg.checkPathLen) return '';
  return `if (${inVar}.length > ${cfg.maxPathLen}) ${bailReturn}`;
}

/** Strip query string. Always emitted — query removal is unconditional. */
export function emitQueryStrip(inVar: string, outVar: string): string {
  return `var ${outVar} = ${inVar}; var qi = ${outVar}.indexOf('?'); if (qi !== -1) ${outVar} = ${outVar}.substring(0, qi);`;
}

/** Trim a single trailing slash. */
export function emitTrailingSlashTrim(cfg: NormalizeCfg, outVar: string): string {
  if (!cfg.trimSlash) return '';
  return `if (${outVar}.length > 1 && ${outVar}.charCodeAt(${outVar}.length - 1) === 47) ${outVar} = ${outVar}.substring(0, ${outVar}.length - 1);`;
}

/** Case-fold to lowercase. */
export function emitLowerCase(cfg: NormalizeCfg, outVar: string): string {
  if (!cfg.lowerCase) return '';
  return `${outVar} = ${outVar}.toLowerCase();`;
}

/**
 * Per-segment length scan. Skipped entirely when `outVar.length` cannot
 * exceed the limit (a path shorter than maxSegLen cannot have a segment
 * longer than it).
 */
export function emitSegLenCheck(cfg: NormalizeCfg, outVar: string, bailReturn: string): string {
  if (!cfg.checkSegLen) return '';
  return `if (${outVar}.length > ${cfg.maxSegLen}) {
    for (var nrm_i = 1, nrm_sl = 0, nrm_ml = ${cfg.maxSegLen}; nrm_i < ${outVar}.length; nrm_i++) {
      if (${outVar}.charCodeAt(nrm_i) === 47) { nrm_sl = 0; }
      else { nrm_sl++; if (nrm_sl > nrm_ml) ${bailReturn} }
    }
  }`;
}

/**
 * Build a standalone normalizer function used by `allowedMethods()` for the
 * 405 classification path. Returns `null` when the path violates either limit,
 * otherwise the normalized lookup key. Compiled once at seal time.
 */
export type PathNormalizer = (path: string) => string | null;

export function buildPathNormalizer(cfg: NormalizeCfg): PathNormalizer {
  const body = [
    emitPathLenCheck(cfg, 'path', 'return null;'),
    emitQueryStrip('path', 'sp'),
    emitTrailingSlashTrim(cfg, 'sp'),
    emitLowerCase(cfg, 'sp'),
    emitSegLenCheck(cfg, 'sp', 'return null;'),
    'return sp;',
  ].filter(Boolean).join('\n');

  return new Function('path', body) as PathNormalizer;
}
