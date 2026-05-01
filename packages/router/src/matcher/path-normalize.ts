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

export type PathNormalizer = (path: string) => string | null;

/**
 * Combined single-pass scanner for path normalization.
 * Finds query index, detects percent encoding, checks segment lengths,
 * and identifies if case-folding is needed in one loop.
 *
 * Returns a JS string that performs the scan and populates sp, hasPercent, and qi.
 */
export function emitSinglePassScan(cfg: NormalizeCfg, inVar: string, bailReturn: string): string {
  const checkSegLen = cfg.checkSegLen;
  const maxSegLen = cfg.maxSegLen;

  return `
    var len = ${inVar}.length;
    var end = len;
    var hasPercent = false;
    var needsFold = false;
    var sl = 0;
    for (var i = 0; i < len; i++) {
      var c = ${inVar}.charCodeAt(i);
      if (c === 63) { end = i; break; } // '?'
      if (c === 37) hasPercent = true;
      if (c >= 65 && c <= 90) needsFold = true;
      ${checkSegLen ? `
      if (c === 47) { sl = 0; }
      else { sl++; if (sl > ${maxSegLen}) ${bailReturn} }` : ''}
    }
    var actualEnd = end;
    if (${cfg.trimSlash} && actualEnd > 1 && ${inVar}.charCodeAt(actualEnd - 1) === 47) actualEnd--;
    var sp = actualEnd === len ? ${inVar} : ${inVar}.substring(0, actualEnd);
    if (needsFold && ${cfg.lowerCase}) sp = sp.toLowerCase();
  `;
}

/** Initial path-length guard. Emits nothing when not configured. */
export function emitPathLenCheck(cfg: NormalizeCfg, inVar: string, bailReturn: string): string {
  if (!cfg.checkPathLen) return '';
  return `if (${inVar}.length > ${cfg.maxPathLen}) ${bailReturn}`;
}

/** Strip query string. Always emitted. */
export function emitQueryStrip(inVar: string, outVar: string, qiName: string = 'qi'): string {
  return `var ${outVar} = ${inVar}; var ${qiName} = ${outVar}.indexOf('?'); if (${qiName} !== -1) ${outVar} = ${outVar}.substring(0, ${qiName});`;
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

/** Per-segment length scan. */
export function emitSegLenCheck(cfg: NormalizeCfg, outVar: string, bailReturn: string): string {
  if (!cfg.checkSegLen) return '';
  return `if (${outVar}.length > ${cfg.maxSegLen}) {
    for (var nrm_i = 1, nrm_sl = 0, nrm_ml = ${cfg.maxSegLen}; nrm_i < ${outVar}.length; nrm_i++) {
      if (${outVar}.charCodeAt(nrm_i) === 47) { nrm_sl = 0; }
      else { nrm_sl++; if (nrm_sl > nrm_ml) ${bailReturn} }
    }
  }`;
}

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
