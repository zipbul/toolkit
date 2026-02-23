import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Locale-specific Validators
// ─────────────────────────────────────────────────────────────────────────────

// ─── isMobilePhone ────────────────────────────────────────────────────────────

const MOBILE_PHONE_REGEXES: Record<string, RegExp> = {
  'ko-KR': /^(\+?82|0)1[016789]\d{7,8}$/,
  'en-US': /^\+?1?[2-9]\d{2}[2-9]\d{6}$/,
  'zh-CN': /^(\+?86)?1[3-9]\d{9}$/,
  'zh-TW': /^(\+?886)?9\d{8}$/,
  'ja-JP': /^(\+?81)?0?[789]0[0-9]{8}$/,
  'de-DE': /^(\+?49)?1(5\d|6[0-9]|7[0-9])\d{8}$/,
  'fr-FR': /^(\+?33)?[67]\d{8}$/,
  'en-GB': /^(\+?44)?7[1-9]\d{8}$/,
  'ru-RU': /^(\+?7)?9\d{9}$/,
  'pt-BR': /^(\+?55)?[1-9]{2}9?\d{8}$/,
  'in-IN': /^(\+?91)?[6-9]\d{9}$/,
  'ar-SA': /^(\+?966)?5\d{8}$/,
  'ar-EG': /^(\+?20)?1[0125]\d{8}$/,
  'vi-VN': /^(\+?84)?[35789]\d{8}$/,
  'th-TH': /^(\+?66)?[689]\d{8}$/,
  'id-ID': /^(\+?62)?8\d{9,11}$/,
  'ms-MY': /^(\+?60)?1\d{8,9}$/,
  'nl-NL': /^(\+?31)?6\d{8}$/,
  'it-IT': /^(\+?39)?3\d{9}$/,
  'es-ES': /^(\+?34)?[67]\d{8}$/,
  'pl-PL': /^(\+?48)?[45789]\d{8}$/,
};

export function isMobilePhone(locale: string): EmittableRule {
  const re = MOBILE_PHONE_REGEXES[locale];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      return ctx.fail('isMobilePhone') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMobilePhone')};`;
  };
  (fn as any).ruleName = 'isMobilePhone';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ─── isPostalCode ─────────────────────────────────────────────────────────────

const POSTAL_CODE_REGEXES: Record<string, RegExp> = {
  AD: /^AD\d{3}$/,
  AT: /^\d{4}$/,
  AU: /^\d{4}$/,
  AZ: /^\d{4}$/,
  BE: /^\d{4}$/,
  BG: /^\d{4}$/,
  BR: /^\d{5}-?\d{3}$/,
  BY: /^\d{6}$/,
  CA: /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  CH: /^\d{4}$/,
  CN: /^\d{6}$/,
  CZ: /^\d{3} ?\d{2}$/,
  DE: /^\d{5}$/,
  DK: /^\d{4}$/,
  EE: /^\d{5}$/,
  ES: /^\d{5}$/,
  FI: /^\d{5}$/,
  FR: /^\d{2} ?\d{3}$/,
  GB: /^(GIR ?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9ABEHMNPRV-Y])?)|[0-9][A-HJKPSTUW]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i,
  GR: /^\d{3} ?\d{2}$/,
  HR: /^\d{5}$/,
  HU: /^\d{4}$/,
  ID: /^\d{5}$/,
  IL: /^\d{5}(\d{2})?$/,
  IN: /^\d{6}$/,
  IS: /^\d{3}$/,
  IT: /^\d{5}$/,
  JP: /^\d{3}-?\d{4}$/,
  KR: /^\d{5}$/,
  LI: /^(948[5-9]|949[0-7])$/,
  LT: /^LT-\d{5}$/,
  LU: /^\d{4}$/,
  LV: /^LV-\d{4}$/,
  MX: /^\d{5}$/,
  MT: /^[A-Z]{3} ?\d{4}$/i,
  MZ: /^\d{4}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  NO: /^\d{4}$/,
  NP: /^\d{5}$/,
  NZ: /^\d{4}$/,
  PH: /^\d{4}$/,
  PK: /^\d{5}$/,
  PL: /^\d{2}-\d{3}$/,
  PR: /^009\d{2}([ -]\d{4})?$/,
  PT: /^\d{4}-\d{3}$/,
  RO: /^\d{6}$/,
  RU: /^\d{6}$/,
  SE: /^\d{3} ?\d{2}$/,
  SG: /^\d{6}$/,
  SI: /^\d{4}$/,
  SK: /^\d{3} ?\d{2}$/,
  TH: /^\d{5}$/,
  TN: /^\d{4}$/,
  TW: /^\d{3}(\d{2})?$/,
  UA: /^\d{5}$/,
  US: /^\d{5}(-\d{4})?$/,
  ZA: /^\d{4}$/,
  ZM: /^\d{5}$/,
};

export function isPostalCode(locale: string): EmittableRule {
  const re = POSTAL_CODE_REGEXES[locale];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      return ctx.fail('isPostalCode') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isPostalCode')};`;
  };
  (fn as any).ruleName = 'isPostalCode';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ─── isIdentityCard ───────────────────────────────────────────────────────────

const IDENTITY_CARD_REGEXES: Record<string, RegExp> = {
  AF:  /^\d{8}$/,
  AL:  /^[A-Z]\d{8}[A-Z]$/i,
  AR:  /^\d{7,8}$/,
  AZ:  /^AZE\d{8}$/,
  BE:  /^\d{11}$/,
  BG:  /^\d{10}$/,
  BR:  /^\d{9}$/,
  BY:  /^[A-Z]{2}\d{7}$/i,
  CA:  /^\d{9}$/,
  CH:  /^756\d{10}$/,
  CN:  /^\d{15}(\d{2}[0-9xX])?$/,
  CY:  /^\d{7}[A-Z]$/i,
  CZ:  /^\d{9,10}$/,
  DE:  /^[LI TOUAEVBMNPRSZDFGHCK]{9}$/i,
  DK:  /^\d{10}$/,
  EE:  /^\d{11}$/,
  ES:  /^[0-9X-Z]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/i,
  FI:  /^\d{6}[+-A]\d{3}[0-9A-FHJ-NPR-Y]$/,
  FR:  /^\d{8,9}[0-9Á-ÿ]{1}$/i,
  GB:  /^[A-Z]{2}\d{6}[A-Z]$/i,
  GR:  /^[A-Z]{2}\d{6}$/i,
  HR:  /^\d{11}$/,
  HU:  /^\d{8}[A-Z]{2}$/i,
  ID:  /^\d{16}$/,
  IE:  /^\d{7}[A-W][A-W]?$/, 
  IL:  /^\d{9}$/,
  IN:  /^\d{12}$/,
  IR:  /^\d{10}$/,
  IS:  /^\d{10}$/,
  IT:  /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i,
  JP:  /^\d{12}$/,
  KR:  /^\d{6}-\d{7}$/,
  LT:  /^\d{11}$/,
  LU:  /^\d{13}$/,
  LV:  /^\d{6}-\d{5}$/,
  MK:  /^\d{13}$/,
  MX:  /^[A-Z]{4}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/i,
  MT:  /^\d{7}[A-Z]$/i,
  NL:  /^\d{9}$/,
  NO:  /^\d{11}$/,
  PL:  /^\d{11}$/,
  PT:  /^[1-9]\d{7}[0-9TV]$/i,
  RO:  /^\d{13}$/,
  RS:  /^\d{13}$/,
  RU:  /^\d{10}$/,
  SE:  /^\d{10,12}$/,
  SI:  /^\d{13}$/,
  SK:  /^\d{9,10}$/,
  TH:  /^\d{13}$/,
  TR:  /^\d{11}$/,
  TW:  /^[A-Z]\d{9}$/i,
  UA:  /^\d{9}$/,
  US:  /^\d{3}-\d{2}-\d{4}$/,
  ZA:  /^\d{13}$/,
};

export function isIdentityCard(locale: string): EmittableRule {
  const re = IDENTITY_CARD_REGEXES[locale];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      return ctx.fail('isIdentityCard') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isIdentityCard')};`;
  };
  (fn as any).ruleName = 'isIdentityCard';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ─── isPassportNumber ─────────────────────────────────────────────────────────

const PASSPORT_REGEXES: Record<string, RegExp> = {
  AM:  /^[A-Z]{2}\d{7}$/i,
  AR:  /^[A-Z]{3}\d{6}$/i,
  AT:  /^[A-Z]\d{7}$/i,
  AU:  /^[A-Z]\d{7}$/i,
  AZ:  /^[Aa]\d{8}$/,
  BE:  /^[A-Z]{2}\d{6}$/i,
  BG:  /^\d{9}$/,
  BH:  /^[A-Z]{2}\d{6}$/i,
  BR:  /^[A-Z]{2}\d{6}$/i,
  BY:  /^[A-Z]{2}\d{7}$/i,
  CA:  /^[A-Z]{2}\d{6}$/i,
  CH:  /^[A-Z]\d{7}$/i,
  CN:  /^G\d{8}$/,
  CY:  /^[A-Z](\d{6}|\d{8})$/i,
  CZ:  /^\d{8}$/,
  DE:  /^[CFGHJKLMNPRTVWXYZ0-9]{9}$/i,
  DK:  /^\d{9}$/,
  EE:  /^([A-Z]\d{7}|[A-Z]{2}\d{7})$/i,
  ES:  /^[A-Z0-9]{2}([A-Z0-9]?)\d{6}$/i,
  FI:  /^[A-Z]{2}\d{7}$/i,
  FR:  /[A-Z0-9]{9}/i,
  GB:  /^\d{9}$/,
  GR:  /^[A-Z]{2}\d{7}$/i,
  HR:  /^\d{9}$/,
  HU:  /^[A-Z]{2}(\d{6}|\d{7})$/i,
  ID:  /^[A-C]\d{7}$/i,
  IE:  /^[A-Z0-9]{2}\d{7}$/i,
  IL:  /^\d{9}$/,
  IN:  /^[A-Z]\d{7}$/i,
  IR:  /^[A-Z]\d{8}$/i,
  IS:  /^(A)\d{7}$/i,
  IT:  /^[A-Z0-9]{9}$/i,
  JO:  /^[A-Z]{2}\d{7}$/i,
  JP:  /^[A-Z]{2}\d{7}$/i,
  KR:  /^[A-Z][A-Z0-9]\d{7}$/i,
  KW:  /^\d{8}$/,
  KZ:  /^[A-Z]\d{8}$/i,
  LI:  /^[A-Z]\d{6}X$/i,
  LT:  /^[A-Z0-9]{8}$/i,
  LU:  /^[A-Z0-9]{8}$/i,
  LV:  /^[A-Z0-9]{2}\d{7}$/i,
  LY:  /^[A-Z]{2}\d{7}$/i,
  MA:  /^[A-Z0-9]{2}\d{7}$/i,
  MD:  /^[A-Z]{2}\d{7}$/i,
  ME:  /^[A-Z]{2}\d{7}$/i,
  MK:  /^[A-Z]\d{7}$/i,
  MT:  /^\d{7}$/,
  MX:  /^[A-Z]\d{8}$/i,
  MY:  /^[AHK]\d{8}[A-Z]$/i,
  NL:  /^[A-NP-Z]{2}[A-NP-Z0-9]{6}\d$/i,
  NO:  /^\d{9}$/,
  NZ:  /^[A-Z]{2}\d{6}$/i,
  PH:  /^[A-Z]\d{7}[A-Z]$/i,
  PK:  /^[A-Z]{2}\d{7}$/i,
  PL:  /^[A-Z]{2}\d{7}$/i,
  PT:  /^[A-Z]\d{6}$/i,
  RO:  /^\d{8}$/,
  RS:  /^\d{9}$/,
  RU:  /^\d{9}$/,
  SA:  /^[A-Z]\d{8}$/i,
  SE:  /^\d{8}$/,
  SL:  /^(P)[A-Z]\d{7}$/i,
  SK:  /^[0-9A-Z]\d{7}$/i,
  TH:  /^[A-Z]{1,2}\d{6,7}$/i,
  TN:  /^\d{8}$/,
  TR:  /^[A-Z]\d{8}$/i,
  TW:  /^[A-Z]\d{9}$/i,
  UA:  /^[A-Z]{2}\d{6}$/i,
  US:  /^\d{9}$/,
  ZA:  /^[A-Z]\d{8}$/i,
};

export function isPassportNumber(locale: string): EmittableRule {
  const re = PASSPORT_REGEXES[locale];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      return ctx.fail('isPassportNumber') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isPassportNumber')};`;
  };
  (fn as any).ruleName = 'isPassportNumber';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}
