/**
 * Path-normalization steps shared by the codegen-emitted matchImpl and the
 * cold-path `allowedMethods()` helper. Each emitter returns a JS string
 * that mutates `sp` in place. Both paths consume the *same* emit strings
 * so a parallel TS implementation cannot drift.
 *
 * The router only normalizes what is **routing policy**: trailing slash
 * and case folding. Path validation (length, percent encoding, raw `?`,
 * raw `#`, etc.) is the upstream framework / HTTP-server's job — by the
 * time a pathname reaches the router we trust it to be a pathname. This
 * keeps the hot path free of `indexOf('?')`, length guards, and segment
 * scans on every request.
 */

export interface NormalizeCfg {
  /** Trim a single trailing slash on paths longer than `/`. */
  trimSlash: boolean;
  /** Apply ASCII/locale-folded `toLowerCase()`. */
  lowerCase: boolean;
}

export type PathNormalizer = (path: string) => string;

/** Trim a single trailing slash. Emits nothing when `trimSlash` is off. */
export function emitTrailingSlashTrim(cfg: NormalizeCfg, outVar: string): string {
  if (!cfg.trimSlash) {
    return '';
  }
  return `if (${outVar}.length > 1 && ${outVar}.charCodeAt(${outVar}.length - 1) === 47) ${outVar} = ${outVar}.substring(0, ${outVar}.length - 1);`;
}

/** Case-fold to lowercase. Emits nothing when `lowerCase` is off. */
export function emitLowerCase(cfg: NormalizeCfg, outVar: string): string {
  if (!cfg.lowerCase) {
    return '';
  }
  return `${outVar} = ${outVar}.toLowerCase();`;
}

export function buildPathNormalizer(cfg: NormalizeCfg): PathNormalizer {
  const body = ['var sp = path;', emitTrailingSlashTrim(cfg, 'sp'), emitLowerCase(cfg, 'sp'), 'return sp;']
    .filter(Boolean)
    .join('\n');

  return new Function('path', body) as PathNormalizer;
}
