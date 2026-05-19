export interface NormalizeCfg {
  trimSlash: boolean;
  lowerCase: boolean;
}

export type PathNormalizer = (path: string) => string;

export function emitTrailingSlashTrim(cfg: NormalizeCfg, outVar: string): string {
  if (!cfg.trimSlash) {
    return '';
  }
  return `if (${outVar}.length > 1 && ${outVar}.charCodeAt(${outVar}.length - 1) === 47) ${outVar} = ${outVar}.substring(0, ${outVar}.length - 1);`;
}

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
