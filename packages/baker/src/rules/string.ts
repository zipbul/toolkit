import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStringRule(
  name: string,
  validate: (v: string) => boolean,
  buildEmit: (varName: string, ctx: EmitContext) => string,
  requiresType: 'string' | undefined = 'string',
): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return validate(value);
  };
  (fn as any).emit = buildEmit;
  (fn as any).ruleName = name;
  if (requiresType !== undefined) (fn as any).requiresType = requiresType;
  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A: Length / Range
// ─────────────────────────────────────────────────────────────────────────────

export function minLength(min: number): EmittableRule {
  const fn = (value: unknown): boolean =>
    typeof value === 'string' && value.length >= min;

  (fn as any).emit = (varName: string, ctx: EmitContext): string =>
    `if (${varName}.length < ${min}) ${ctx.fail('minLength')};`;
  (fn as any).ruleName = 'minLength';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

export function maxLength(max: number): EmittableRule {
  const fn = (value: unknown): boolean =>
    typeof value === 'string' && value.length <= max;

  (fn as any).emit = (varName: string, ctx: EmitContext): string =>
    `if (${varName}.length > ${max}) ${ctx.fail('maxLength')};`;
  (fn as any).ruleName = 'maxLength';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

export function length(minLen: number, maxLen: number): EmittableRule {
  const fn = (value: unknown): boolean =>
    typeof value === 'string' && value.length >= minLen && value.length <= maxLen;

  (fn as any).emit = (varName: string, ctx: EmitContext): string =>
    `if (${varName}.length < ${minLen} || ${varName}.length > ${maxLen}) ${ctx.fail('length')};`;
  (fn as any).ruleName = 'length';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

export function contains(seed: string): EmittableRule {
  const fn = (value: unknown): boolean =>
    typeof value === 'string' && value.includes(seed);

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(seed);
    return `if (${varName}.indexOf(_refs[${i}]) === -1) ${ctx.fail('contains')};`;
  };
  (fn as any).ruleName = 'contains';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

export function notContains(seed: string): EmittableRule {
  const fn = (value: unknown): boolean =>
    typeof value === 'string' && !value.includes(seed);

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(seed);
    return `if (${varName}.indexOf(_refs[${i}]) !== -1) ${ctx.fail('notContains')};`;
  };
  (fn as any).ruleName = 'notContains';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

export function matches(pattern: string | RegExp, modifiers?: string): EmittableRule {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, modifiers);

  const fn = (value: unknown): boolean =>
    typeof value === 'string' && re.test(value);

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('matches')};`;
  };
  (fn as any).ruleName = 'matches';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B: Simple Boolean Checks
// ─────────────────────────────────────────────────────────────────────────────

const _isLowercase = (value: unknown): boolean =>
  typeof value === 'string' && value === value.toLowerCase();

(_isLowercase as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName} !== ${varName}.toLowerCase()) ${ctx.fail('isLowercase')};`;
(_isLowercase as any).ruleName = 'isLowercase';
(_isLowercase as any).requiresType = 'string';
export const isLowercase = _isLowercase as EmittableRule;

const _isUppercase = (value: unknown): boolean =>
  typeof value === 'string' && value === value.toUpperCase();

(_isUppercase as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName} !== ${varName}.toUpperCase()) ${ctx.fail('isUppercase')};`;
(_isUppercase as any).ruleName = 'isUppercase';
(_isUppercase as any).requiresType = 'string';
export const isUppercase = _isUppercase as EmittableRule;

// ASCII: all code points in [0x00, 0x7F]
const ASCII_RE = /^[\x00-\x7F]*$/;
export const isAscii = makeStringRule(
  'isAscii',
  (v) => ASCII_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(ASCII_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isAscii')};`;
  },
);

// Alpha — default en-US locale singleton that also acts as factory
// Usage: isAlpha('HelloWorld') → boolean  OR  isAlpha() → EmittableRule
const ALPHA_DEFAULT_RE = /^[a-zA-Z]+$/;

function _alphaValidate(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && ALPHA_DEFAULT_RE.test(value);
}

// The exported symbol is itself an EmittableRule (validates with default en-US)
// but when called with no arguments returns itself (for factory-like usage)
const _isAlpha = function isAlpha(value?: unknown): boolean | EmittableRule {
  if (value === undefined) return isAlpha as unknown as EmittableRule;
  return _alphaValidate(value);
} as unknown as EmittableRule;

(_isAlpha as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRegex(ALPHA_DEFAULT_RE);
  return `if (!_re[${i}].test(${varName})) ${ctx.fail('isAlpha')};`;
};
(_isAlpha as any).ruleName = 'isAlpha';
(_isAlpha as any).requiresType = 'string';
export const isAlpha = _isAlpha;

// Alphanumeric — same dual pattern
const ALNUM_DEFAULT_RE = /^[a-zA-Z0-9]+$/;

function _alnumValidate(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && ALNUM_DEFAULT_RE.test(value);
}

const _isAlphanumeric = function isAlphanumeric(value?: unknown): boolean | EmittableRule {
  if (value === undefined) return isAlphanumeric as unknown as EmittableRule;
  return _alnumValidate(value);
} as unknown as EmittableRule;

(_isAlphanumeric as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRegex(ALNUM_DEFAULT_RE);
  return `if (!_re[${i}].test(${varName})) ${ctx.fail('isAlphanumeric')};`;
};
(_isAlphanumeric as any).ruleName = 'isAlphanumeric';
(_isAlphanumeric as any).requiresType = 'string';
export const isAlphanumeric = _isAlphanumeric;

// BooleanString: 'true' | 'false' | '1' | '0'
const _isBooleanString = (value: unknown): boolean =>
  value === 'true' || value === 'false' || value === '1' || value === '0';

(_isBooleanString as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName} !== 'true' && ${varName} !== 'false' && ${varName} !== '1' && ${varName} !== '0') ${ctx.fail('isBooleanString')};`;
(_isBooleanString as any).ruleName = 'isBooleanString';
(_isBooleanString as any).requiresType = 'string';
export const isBooleanString = _isBooleanString as EmittableRule;

export interface IsNumberStringOptions {
  no_symbols?: boolean;
}

export function isNumberString(options?: IsNumberStringOptions): EmittableRule {
  return makeStringRule(
    'isNumberString',
    (v) => {
      if (v.length === 0) return false;
      const n = Number(v);
      return !isNaN(n) && isFinite(n);
    },
    (varName, ctx) => {
      // emit: ref-based (Number() conversion + NaN/Infinity check)
      const checkFn = (s: string): boolean => {
        if (s.length === 0) return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
      };
      const i = ctx.addRef(checkFn);
      return `if (!_refs[${i}](${varName})) ${ctx.fail('isNumberString')};`;
    },
  );
}

export interface IsDecimalOptions {
  decimal_digits?: string;
  force_decimal?: boolean;
  locale?: string;
}

export function isDecimal(options?: IsDecimalOptions): EmittableRule {
  const decimalRe = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  return makeStringRule(
    'isDecimal',
    (v) => decimalRe.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(decimalRe);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isDecimal')};`;
    },
  );
}

// Full-width characters (Unicode fullwidth forms)
const FULLWIDTH_RE = /[^\u0020-\u007E\uFF61-\uFF9F]/;
export const isFullWidth = makeStringRule(
  'isFullWidth',
  (v) => v.length > 0 && FULLWIDTH_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(FULLWIDTH_RE);
    return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isFullWidth')};`;
  },
);

// Half-width characters
const HALFWIDTH_RE = /[\u0020-\u007E\uFF61-\uFF9F]/;
export const isHalfWidth = makeStringRule(
  'isHalfWidth',
  (v) => v.length > 0 && HALFWIDTH_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(HALFWIDTH_RE);
    return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isHalfWidth')};`;
  },
);

// Variable-width: must contain both full-width AND half-width
export const isVariableWidth = makeStringRule(
  'isVariableWidth',
  (v) => FULLWIDTH_RE.test(v) && HALFWIDTH_RE.test(v),
  (varName, ctx) => {
    const i1 = ctx.addRegex(FULLWIDTH_RE);
    const i2 = ctx.addRegex(HALFWIDTH_RE);
    return `if (!_re[${i1}].test(${varName}) || !_re[${i2}].test(${varName})) ${ctx.fail('isVariableWidth')};`;
  },
);

// Multibyte: any character outside Latin-1 / half-width range
const MULTIBYTE_RE = /[^\x00-\xFF]/;
export const isMultibyte = makeStringRule(
  'isMultibyte',
  (v) => v.length > 0 && MULTIBYTE_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(MULTIBYTE_RE);
    return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isMultibyte')};`;
  },
);

// Surrogate pairs
const SURROGATE_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
export const isSurrogatePair = makeStringRule(
  'isSurrogatePair',
  (v) => v.length > 0 && SURROGATE_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(SURROGATE_RE);
    return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isSurrogatePair')};`;
  },
);

// Hexadecimal
const HEX_RE = /^[0-9a-fA-F]+$/;
export const isHexadecimal = makeStringRule(
  'isHexadecimal',
  (v) => HEX_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(HEX_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isHexadecimal')};`;
  },
);

// Octal
const OCTAL_RE = /^(0[oO])?[0-7]+$/;
export const isOctal = makeStringRule(
  'isOctal',
  (v) => v.length > 0 && OCTAL_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(OCTAL_RE);
    return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isOctal')};`;
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Group C: Regex-based
// ─────────────────────────────────────────────────────────────────────────────

// Email — RFC 5322 simplified
export interface IsEmailOptions {
  allow_display_name?: boolean;
  allow_utf8_local_part?: boolean;
  require_tld?: boolean;
}

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export function isEmail(_options?: IsEmailOptions): EmittableRule {
  return makeStringRule(
    'isEmail',
    (v) => EMAIL_RE.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(EMAIL_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isEmail')};`;
    },
  );
}

// URL — RFC 3986 simplified
export interface IsURLOptions {
  protocols?: string[];
  require_tld?: boolean;
  require_protocol?: boolean;
  allow_underscores?: boolean;
  allow_trailing_dot?: boolean;
  allow_protocol_relative_urls?: boolean;
}

const URL_PROTOCOLS_DEFAULT = ['http', 'https', 'ftp'];

export function isURL(options?: IsURLOptions): EmittableRule {
  const protocols = options?.protocols ?? URL_PROTOCOLS_DEFAULT;
  const protocolPattern = protocols.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(
    `^(?:${protocolPattern}):\\/\\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)(?::\\d{1,5})?(?:\\/[^\\s]*)?$`,
  );

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string' || value.length === 0) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isURL')};`;
  };
  (fn as any).ruleName = 'isURL';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// UUID
const UUID_RE: Record<string | number, RegExp> = {
  all: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  1: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-1[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  2: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-2[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  3: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-3[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  4: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  5: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-5[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
};

export function isUUID(version?: 1 | 2 | 3 | 4 | 5 | 'all'): EmittableRule {
  const re = version != null ? (UUID_RE[version] ?? UUID_RE.all) : UUID_RE.all;
  return makeStringRule(
    'isUUID',
    (v) => re.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(re);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isUUID')};`;
    },
  );
}

// IP
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/;
const IPV6_RE = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^::$|^::1$|^::(?:ffff(?::0{1,4})?:)?(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$|^(?:[0-9a-fA-F]{1,4}:){1,4}:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

export function isIP(version?: 4 | 6): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (version === 4) return IPV4_RE.test(value);
    if (version === 6) return IPV6_RE.test(value);
    return IPV4_RE.test(value) || IPV6_RE.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (version === 4) {
      const i = ctx.addRegex(IPV4_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isIP')};`;
    }
    if (version === 6) {
      const i = ctx.addRegex(IPV6_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isIP')};`;
    }
    const i4 = ctx.addRegex(IPV4_RE);
    const i6 = ctx.addRegex(IPV6_RE);
    return `if (!_re[${i4}].test(${varName}) && !_re[${i6}].test(${varName})) ${ctx.fail('isIP')};`;
  };
  (fn as any).ruleName = 'isIP';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// HexColor: #RGB or #RRGGBB
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const isHexColor = makeStringRule(
  'isHexColor',
  (v) => HEX_COLOR_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(HEX_COLOR_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isHexColor')};`;
  },
);

// RgbColor
const RGB_RE = /^rgb\(\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*,\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*,\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*\)$/;
const RGBA_RE = /^rgba\(\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*,\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*,\s*(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\s*,\s*(0|0?\.\d+|1(\.0+)?)\s*\)$/;
const RGB_PERCENT_RE = /^rgba?\(\s*(\d{1,2}|100)%\s*,\s*(\d{1,2}|100)%\s*,\s*(\d{1,2}|100)%(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;

export function isRgbColor(includePercentValues: boolean = false): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (includePercentValues) return RGB_PERCENT_RE.test(value);
    return RGB_RE.test(value) || RGBA_RE.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (includePercentValues) {
      const i = ctx.addRegex(RGB_PERCENT_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isRgbColor')};`;
    }
    const i1 = ctx.addRegex(RGB_RE);
    const i2 = ctx.addRegex(RGBA_RE);
    return `if (!_re[${i1}].test(${varName}) && !_re[${i2}].test(${varName})) ${ctx.fail('isRgbColor')};`;
  };
  (fn as any).ruleName = 'isRgbColor';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// HSL: hsl(H, S%, L%) or hsla(H, S%, L%, A)
const HSL_RE = /^hsla?\(\s*(360|3[0-5]\d|[12]\d{2}|[1-9]\d|\d)\s*,\s*(100|[1-9]\d|\d)%\s*,\s*(100|[1-9]\d|\d)%(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;
export const isHSL = makeStringRule(
  'isHSL',
  (v) => HSL_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(HSL_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isHSL')};`;
  },
);

// MAC Address
export interface IsMACAddressOptions {
  no_separators?: boolean;
}

const MAC_COLON_RE = /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/;
const MAC_HYPHEN_RE = /^[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}$/;
const MAC_NO_SEP_RE = /^[0-9a-fA-F]{12}$/;

export function isMACAddress(options?: IsMACAddressOptions): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (options?.no_separators) return MAC_NO_SEP_RE.test(value);
    return MAC_COLON_RE.test(value) || MAC_HYPHEN_RE.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (options?.no_separators) {
      const i = ctx.addRegex(MAC_NO_SEP_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMACAddress')};`;
    }
    const i1 = ctx.addRegex(MAC_COLON_RE);
    const i2 = ctx.addRegex(MAC_HYPHEN_RE);
    return `if (!_re[${i1}].test(${varName}) && !_re[${i2}].test(${varName})) ${ctx.fail('isMACAddress')};`;
  };
  (fn as any).ruleName = 'isMACAddress';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ISBN
function _validateISBN10(str: string): boolean {
  const s = str.replace(/[-\s]/g, '');
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * (s.charCodeAt(i) - 48);
  const last = s[9] === 'X' ? 10 : (s.charCodeAt(9) - 48);
  sum += last;
  return sum % 11 === 0;
}

function _validateISBN13(str: string): boolean {
  const s = str.replace(/[-\s]/g, '');
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (s.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === (s.charCodeAt(12) - 48);
}

export function isISBN(version?: 10 | 13): EmittableRule {
  const validateFn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (version === 10) return _validateISBN10(value);
    if (version === 13) return _validateISBN13(value);
    return _validateISBN10(value) || _validateISBN13(value);
  };

  (validateFn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(validateFn);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isISBN')};`;
  };
  (validateFn as any).ruleName = 'isISBN';
  (validateFn as any).requiresType = 'string';

  return validateFn as EmittableRule;
}

// ISIN — ISO 6166
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function _validateISINStr(v: string): boolean {
  if (!ISIN_RE.test(v)) return false;
  // Luhn mod10 on expanded digits
  const expanded = v
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 65 ? String(code - 55) : c;
    })
    .join('');
  let sum = 0;
  let alternate = false;
  for (let i = expanded.length - 1; i >= 0; i--) {
    let n = parseInt(expanded[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export const isISIN = makeStringRule(
  'isISIN',
  _validateISINStr,
  (varName, ctx) => {
    const i = ctx.addRef(_validateISINStr);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isISIN')};`;
  },
);

// ISO 8601
const ISO8601_RE = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)?)?$/;

export interface IsISO8601Options {
  strict?: boolean;
}

// Strict ISO8601: requires month/day to be valid values
function _validateISO8601Strict(v: string): boolean {
  if (!ISO8601_RE.test(v)) return false;
  // Extract date components if present
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return true; // year-only or year-month partial — still ok per regex
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const maxDay = new Date(Number(m[1]), month, 0).getDate();
  return day >= 1 && day <= maxDay;
}

export function isISO8601(options?: IsISO8601Options): EmittableRule {
  if (options?.strict) {
    // strict: validate and emit use the same function ref to stay in sync
    const fn = (v: unknown): boolean => {
      if (typeof v !== 'string') return false;
      return _validateISO8601Strict(v);
    };
    (fn as any).ruleName = 'isISO8601';
    (fn as any).emit = (varName: string, ctx: EmitContext): string => {
      const i = ctx.addRef(fn);
      return `if (!_refs[${i}](${varName})) ${ctx.fail('isISO8601')};`;
    };
    return fn as unknown as EmittableRule;
  }
  // non-strict: both validate and emit use same ISO8601_RE
  return makeStringRule(
    'isISO8601',
    (v) => ISO8601_RE.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(ISO8601_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isISO8601')};`;
    },
  );
}

// ISRC — ISO 3901
const ISRC_RE = /^[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d{5}$|^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const isISRC = makeStringRule(
  'isISRC',
  (v) => ISRC_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(ISRC_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isISRC')};`;
  },
);

// ISSN
export interface IsISSNOptions {
  case_sensitive?: boolean;
  requireHyphen?: boolean;
}

function _validateISSN(value: string, options?: IsISSNOptions): boolean {
  const requireHyphen = options?.requireHyphen !== false;
  const s = requireHyphen ? value : value.replace(/-/g, '');
  // Format with hyphen: NNNN-NNNX, without: NNNNNNXX
  const re = requireHyphen ? /^\d{4}-\d{3}[\dX]$/ : /^\d{7}[\dX]$/;
  if (!re.test(s)) return false;
  const digits = s.replace(/-/g, '');
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += (8 - i) * (digits.charCodeAt(i) - 48);
  }
  const last = digits[7] === 'X' ? 10 : (digits.charCodeAt(7) - 48);
  sum += last;
  return sum % 11 === 0;
}

export function isISSN(options?: IsISSNOptions): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return _validateISSN(value, options);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(fn);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isISSN')};`;
  };
  (fn as any).ruleName = 'isISSN';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// JWT — 3-part dot-separated base64url
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const isJWT = makeStringRule(
  'isJWT',
  (v) => JWT_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(JWT_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isJWT')};`;
  },
);

// LatLong
export interface IsLatLongOptions {
  checkDMS?: boolean;
}

const LAT_LONG_RE = /^[-+]?([1-8]?\d(?:\.\d+)?|90(?:\.0+)?),\s*[-+]?(180(?:\.0+)?|1[0-7]\d(?:\.\d+)?|\d{1,2}(?:\.\d+)?)$/;

export function isLatLong(options?: IsLatLongOptions): EmittableRule {
  return makeStringRule(
    'isLatLong',
    (v) => LAT_LONG_RE.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(LAT_LONG_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isLatLong')};`;
    },
  );
}

// Locale — BCP 47 simplified
const LOCALE_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-(?:[a-zA-Z]{2}|\d{3}))?(?:-[a-zA-Z\d]{5,8})*$/;
export const isLocale = makeStringRule(
  'isLocale',
  (v) => LOCALE_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(LOCALE_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isLocale')};`;
  },
);

// DataURI
const DATA_URI_RE = /^data:([a-zA-Z0-9!#$&\-^_]+\/[a-zA-Z0-9!#$&\-^_]+)(?:;[a-zA-Z0-9\-]+=[a-zA-Z0-9\-]+)*(?:;base64)?,[\s\S]*$/;
export const isDataURI = makeStringRule(
  'isDataURI',
  (v) => DATA_URI_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(DATA_URI_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isDataURI')};`;
  },
);

// FQDN
export interface IsFQDNOptions {
  require_tld?: boolean;
  allow_underscores?: boolean;
  allow_trailing_dot?: boolean;
}

export function isFQDN(options?: IsFQDNOptions): EmittableRule {
  const requireTld = options?.require_tld !== false;

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    let str = value;
    if (options?.allow_trailing_dot && str.endsWith('.')) str = str.slice(0, -1);
    if (str.length === 0) return false;
    const parts = str.split('.');
    // Must have at least 2 parts (host + tld) when requireTld is true
    if (requireTld && parts.length < 2) return false;
    if (requireTld) {
      const tld = parts[parts.length - 1];
      if (!tld || tld.length < 2 || !/^[a-zA-Z]{2,}$/.test(tld)) return false;
    }
    return parts.every((part) => {
      if (part.length === 0 || part.length > 63) return false;
      if (options?.allow_underscores) return /^[a-zA-Z0-9_-]+$/.test(part);
      return /^[a-zA-Z0-9-]+$/.test(part) && !part.startsWith('-') && !part.endsWith('-');
    });
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(fn);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isFQDN')};`;
  };
  (fn as any).ruleName = 'isFQDN';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// Port — 0 to 65535
const PORT_RE = /^(?:6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{1,3}|\d)$/;
export const isPort = makeStringRule(
  'isPort',
  (v) => PORT_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(PORT_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isPort')};`;
  },
);

// EAN (EAN-8 and EAN-13 with checksum)
function _validateEAN(value: string): boolean {
  if (!/^\d{8}$/.test(value) && !/^\d{13}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const len = digits.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    sum += digits[i] * (len === 8 ? (i % 2 === 0 ? 3 : 1) : (i % 2 === 0 ? 1 : 3));
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[len - 1];
}

export const isEAN = makeStringRule(
  'isEAN',
  _validateEAN,
  (varName, ctx) => {
    const i = ctx.addRef(_validateEAN);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isEAN')};`;
  },
);

// ISO 3166-1 Alpha-2
const ISO31661A2_CODES = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA','RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU',
  'WF','WS','YE','YT','ZA','ZM','ZW',
]);

const _isISO31661Alpha2 = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return ISO31661A2_CODES.has(value.toUpperCase());
};

(_isISO31661Alpha2 as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRef(ISO31661A2_CODES);
  return `if (!_refs[${i}].has(${varName}.toUpperCase())) ${ctx.fail('isISO31661Alpha2')};`;
};
(_isISO31661Alpha2 as any).ruleName = 'isISO31661Alpha2';
(_isISO31661Alpha2 as any).requiresType = 'string';
export const isISO31661Alpha2 = _isISO31661Alpha2 as EmittableRule;

// ISO 3166-1 Alpha-3
const ISO31661A3_CODES = new Set([
  'ABW','AFG','AGO','AIA','ALA','ALB','AND','ANT','ARE','ARG','ARM','ASM','ATA','ATF','ATG','AUS','AUT','AZE',
  'BDI','BEL','BEN','BES','BFA','BGD','BGR','BHR','BHS','BIH','BLM','BLR','BLZ','BMU','BOL','BRA','BRB','BRN','BTN','BVT','BWA',
  'CAF','CAN','CCK','CHE','CHL','CHN','CIV','CMR','COD','COG','COK','COL','COM','CPV','CRI','CUB','CUW','CXR','CYM','CYP','CZE',
  'DEU','DJI','DMA','DNK','DOM','DZA','ECU','EGY','ERI','ESH','ESP','EST','ETH',
  'FIN','FJI','FLK','FRA','FRO','FSM','GAB','GBR','GEO','GGY','GHA','GIB','GIN','GLP','GMB','GNB','GNQ','GRC','GRD','GRL','GTM','GUF','GUM','GUY',
  'HKG','HMD','HND','HRV','HTI','HUN','IDN','IMN','IND','IOT','IRL','IRN','IRQ','ISL','ISR','ITA',
  'JAM','JEY','JOR','JPN','KAZ','KEN','KGZ','KHM','KIR','KNA','KOR','KWT',
  'LAO','LBN','LBR','LBY','LCA','LIE','LKA','LSO','LTU','LUX','LVA',
  'MAC','MAF','MAR','MCO','MDA','MDG','MDV','MEX','MHL','MKD','MLI','MLT','MMR','MNE','MNG','MNP','MOZ','MRT','MSR','MTQ','MUS','MWI','MYS','MYT',
  'NAM','NCL','NER','NFK','NGA','NIC','NIU','NLD','NOR','NPL','NRU','NZL',
  'OMN','PAK','PAN','PCN','PER','PHL','PLW','PNG','POL','PRI','PRK','PRT','PRY','PSE','PYF',
  'QAT','REU','ROU','RUS','RWA',
  'SAU','SDN','SEN','SGP','SGS','SHN','SJM','SLB','SLE','SLV','SMR','SOM','SPM','SRB','SSD','STP','SUR','SVK','SVN','SWE','SWZ','SXM','SYC','SYR',
  'TCA','TCD','TGO','THA','TJK','TKL','TKM','TLS','TON','TTO','TUN','TUR','TUV','TWN','TZA',
  'UGA','UKR','UMI','URY','USA','UZB','VAT','VCT','VEN','VGB','VIR','VNM','VUT',
  'WLF','WSM','YEM','ZAF','ZMB','ZWE',
]);

const _isISO31661Alpha3 = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return ISO31661A3_CODES.has(value.toUpperCase());
};

(_isISO31661Alpha3 as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRef(ISO31661A3_CODES);
  return `if (!_refs[${i}].has(${varName}.toUpperCase())) ${ctx.fail('isISO31661Alpha3')};`;
};
(_isISO31661Alpha3 as any).ruleName = 'isISO31661Alpha3';
(_isISO31661Alpha3 as any).requiresType = 'string';
export const isISO31661Alpha3 = _isISO31661Alpha3 as EmittableRule;

// BIC / SWIFT code
const BIC_RE = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
export const isBIC = makeStringRule(
  'isBIC',
  (v) => BIC_RE.test(v.toUpperCase()),
  (varName, ctx) => {
    const i = ctx.addRegex(BIC_RE);
    return `if (!_re[${i}].test(${varName}.toUpperCase())) ${ctx.fail('isBIC')};`;
  },
);

// Firebase Push ID — 20 chars, base64url charset (-0-9A-Za-z_)
const FIREBASE_RE = /^[a-zA-Z0-9_-]{20}$/;
export const isFirebasePushId = makeStringRule(
  'isFirebasePushId',
  (v) => FIREBASE_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(FIREBASE_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isFirebasePushId')};`;
  },
);

// SemVer — Semantic Versioning 2.0
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
export const isSemVer = makeStringRule(
  'isSemVer',
  (v) => SEMVER_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(SEMVER_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isSemVer')};`;
  },
);

// MongoDB ObjectId — 24-char hex
const MONGO_ID_RE = /^[0-9a-fA-F]{24}$/;
export const isMongoId = makeStringRule(
  'isMongoId',
  (v) => MONGO_ID_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(MONGO_ID_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMongoId')};`;
  },
);

// JSON
const _isJSON = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

(_isJSON as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRef((s: string) => {
    try { JSON.parse(s); return true; } catch { return false; }
  });
  return `if (!_refs[${i}](${varName})) ${ctx.fail('isJSON')};`;
};
(_isJSON as any).ruleName = 'isJSON';
(_isJSON as any).requiresType = 'string';
export const isJSON = _isJSON as EmittableRule;

// Base32
const BASE32_RE = /^[A-Z2-7]+=*$/i;
const BASE32_HEX_RE = /^[0-9A-V]+=*$/i;

export interface IsBase32Options {
  crockford?: boolean;
}

export function isBase32(options?: IsBase32Options): EmittableRule {
  const re = BASE32_RE;
  return makeStringRule(
    'isBase32',
    (v) => {
      if (v.length === 0) return false;
      if (v.length % 8 !== 0) return false;
      return re.test(v);
    },
    (varName, ctx) => {
      const i = ctx.addRegex(re);
      return `if (${varName}.length === 0 || ${varName}.length % 8 !== 0 || !_re[${i}].test(${varName})) ${ctx.fail('isBase32')};`;
    },
  );
}

// Base58
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
export const isBase58 = makeStringRule(
  'isBase58',
  (v) => BASE58_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(BASE58_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isBase58')};`;
  },
);

// Base64
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

export interface IsBase64Options {
  urlSafe?: boolean;
}

export function isBase64(options?: IsBase64Options): EmittableRule {
  const re = options?.urlSafe ? BASE64_URL_RE : BASE64_RE;
  return makeStringRule(
    'isBase64',
    (v) => {
      if (v.length === 0) return false;
      return re.test(v);
    },
    (varName, ctx) => {
      const i = ctx.addRegex(re);
      return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isBase64')};`;
    },
  );
}

// DateString — ISO 8601 date only (YYYY-MM-DD)
const DATE_STRING_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export interface IsDateStringOptions {
  strictMode?: boolean;
}

export function isDateString(options?: IsDateStringOptions): EmittableRule {
  return makeStringRule(
    'isDateString',
    (v) => DATE_STRING_RE.test(v),
    (varName, ctx) => {
      const i = ctx.addRegex(DATE_STRING_RE);
      return `if (!_re[${i}].test(${varName})) ${ctx.fail('isDateString')};`;
    },
  );
}

// MimeType
const MIME_TYPE_RE = /^(application|audio|font|image|message|model|multipart|text|video)\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*(?:;.+)?$/;
export const isMimeType = makeStringRule(
  'isMimeType',
  (v) => MIME_TYPE_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(MIME_TYPE_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMimeType')};`;
  },
);

// Currency
export interface IsCurrencyOptions {
  symbol?: string;
  require_symbol?: boolean;
  allow_space_after_symbol?: boolean;
  symbol_after_digits?: boolean;
  allow_negatives?: boolean;
  parens_for_negatives?: boolean;
  negative_sign_before_digits?: boolean;
  negative_sign_after_digits?: boolean;
  allow_negative_sign_placeholder?: boolean;
  thousands_separator?: string;
  decimal_separator?: string;
  allow_decimal?: boolean;
  require_decimal?: boolean;
  digits_after_decimal?: number[];
  allow_space_after_digits?: boolean;
}

const CURRENCY_RE = /^[-+]?(?:[,.\d]+)(?:[.,]\d{2})?$|^\$?-?(?:\d+|\d{1,3}(?:,\d{3})*)(?:\.\d{1,2})?$/;

export function isCurrency(options?: IsCurrencyOptions): EmittableRule {
  return makeStringRule(
    'isCurrency',
    (v) => {
      if (v.length === 0) return false;
      return CURRENCY_RE.test(v);
    },
    (varName, ctx) => {
      const i = ctx.addRegex(CURRENCY_RE);
      return `if (${varName}.length === 0 || !_re[${i}].test(${varName})) ${ctx.fail('isCurrency')};`;
    },
  );
}

// Magnet URI
const MAGNET_URI_RE = /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,40}/i;
export const isMagnetURI = makeStringRule(
  'isMagnetURI',
  (v) => MAGNET_URI_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(MAGNET_URI_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMagnetURI')};`;
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Group D: Algorithm-based
// ─────────────────────────────────────────────────────────────────────────────

// Credit Card — Luhn algorithm (§4.8 C)
function _luhn(str: string): boolean {
  const s = str.replace(/[\s-]/g, '');
  if (s.length === 0 || !/^\d+$/.test(s)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = s.charCodeAt(i) - 48;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const _isCreditCard = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return _luhn(value);
};

// emit: Luhn algorithm펼침 (§4.8 C 패턴)
(_isCreditCard as any).emit = (varName: string, ctx: EmitContext): string => `{
  var _cs=${varName}.replace(/[\\s-]/g,'');
  if(_cs.length===0||!/^\\d+$/.test(_cs)){${ctx.fail('isCreditCard')}}
  else{var _sum=0,_alt=false;
  for(var _ci=_cs.length-1;_ci>=0;_ci--){var _cn=_cs.charCodeAt(_ci)-48;if(_alt){_cn*=2;if(_cn>9)_cn-=9;}_sum+=_cn;_alt=!_alt;}
  if(_sum%10!==0)${ctx.fail('isCreditCard')};}
}`;
(_isCreditCard as any).ruleName = 'isCreditCard';
(_isCreditCard as any).requiresType = 'string';
export const isCreditCard = _isCreditCard as EmittableRule;

// IBAN — ISO 13616 mod-97
export interface IsIBANOptions {
  allowSpaces?: boolean;
}

const IBAN_COUNTRY_LENGTH: Record<string, number> = {
  'AD': 24, 'AE': 23, 'AL': 28, 'AT': 20, 'AZ': 28, 'BA': 20, 'BE': 16, 'BG': 22, 'BH': 22,
  'BR': 29, 'CH': 21, 'CR': 22, 'CY': 28, 'CZ': 24, 'DE': 22, 'DK': 18, 'DO': 28, 'EE': 20,
  'ES': 24, 'FI': 18, 'FO': 18, 'FR': 27, 'GB': 22, 'GE': 22, 'GI': 23, 'GL': 18, 'GR': 27,
  'GT': 28, 'HR': 21, 'HU': 28, 'IE': 22, 'IL': 23, 'IS': 26, 'IT': 27, 'JO': 30, 'KW': 30,
  'KZ': 20, 'LB': 28, 'LC': 32, 'LI': 21, 'LT': 20, 'LU': 20, 'LV': 21, 'MC': 27, 'MD': 24,
  'ME': 22, 'MK': 19, 'MR': 27, 'MT': 31, 'MU': 30, 'NL': 18, 'NO': 15, 'PK': 24, 'PL': 28,
  'PS': 29, 'PT': 25, 'QA': 29, 'RO': 24, 'RS': 22, 'SA': 24, 'SC': 31, 'SE': 24, 'SI': 19,
  'SK': 24, 'SM': 27, 'ST': 25, 'SV': 28, 'TL': 23, 'TN': 24, 'TR': 26, 'UA': 29, 'VA': 22,
  'VG': 24, 'XK': 20,
};

function _validateIBAN(value: string, options?: IsIBANOptions): boolean {
  let s = options?.allowSpaces ? value.replace(/\s/g, '') : value;
  s = s.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const country = s.slice(0, 2);
  const expectedLength = IBAN_COUNTRY_LENGTH[country];
  if (expectedLength !== undefined && s.length !== expectedLength) return false;
  // Rearrange: move first 4 chars to end
  const rearranged = s.slice(4) + s.slice(0, 4);
  // Convert letters to digits (A=10, B=11, ...)
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  // Compute mod 97 on large number in chunks
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = String(remainder) + numeric.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder === 1;
}

export function isIBAN(options?: IsIBANOptions): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return _validateIBAN(value, options);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(fn);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isIBAN')};`;
  };
  (fn as any).ruleName = 'isIBAN';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ByteLength — counts UTF-8 bytes via TextEncoder
export function isByteLength(min: number, max?: number): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const byteLen = new TextEncoder().encode(value).length;
    if (byteLen < min) return false;
    if (max !== undefined && byteLen > max) return false;
    return true;
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    // emit: ref-based (TextEncoder is available in all modern runtimes incl. Bun)
    const checkFn = (s: string): boolean => {
      const byteLen = new TextEncoder().encode(s).length;
      if (byteLen < min) return false;
      if (max !== undefined && byteLen > max) return false;
      return true;
    };
    const i = ctx.addRef(checkFn);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isByteLength')};`;
  };
  (fn as any).ruleName = 'isByteLength';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group E: New Validators
// ─────────────────────────────────────────────────────────────────────────────

// isHash — hash algorithm별 hex 정규식 (§4.8 B: 정규식 인라인)

const HASH_REGEXES: Record<string, RegExp> = {
  md5:        /^[a-f0-9]{32}$/i,
  md4:        /^[a-f0-9]{32}$/i,
  md2:        /^[a-f0-9]{32}$/i,
  sha1:       /^[a-f0-9]{40}$/i,
  sha256:     /^[a-f0-9]{64}$/i,
  sha384:     /^[a-f0-9]{96}$/i,
  sha512:     /^[a-f0-9]{128}$/i,
  ripemd128:  /^[a-f0-9]{32}$/i,
  ripemd160:  /^[a-f0-9]{40}$/i,
  'tiger128,3': /^[a-f0-9]{32}$/i,
  'tiger128,4': /^[a-f0-9]{32}$/i,
  'tiger160,3': /^[a-f0-9]{40}$/i,
  'tiger160,4': /^[a-f0-9]{40}$/i,
  'tiger192,3': /^[a-f0-9]{48}$/i,
  'tiger192,4': /^[a-f0-9]{48}$/i,
  crc32:      /^[a-f0-9]{8}$/i,
  crc32b:     /^[a-f0-9]{8}$/i,
};

export function isHash(algorithm: string): EmittableRule {
  const re = HASH_REGEXES[algorithm];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      // 알 수 없는 알고리즘 → 항상 실패
      return ctx.fail('isHash') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isHash')};`;
  };
  (fn as any).ruleName = 'isHash';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// isRFC3339 — RFC 3339 datetime (§4.8 B)

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

export const isRFC3339 = makeStringRule(
  'isRFC3339',
  (v) => RFC3339_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(RFC3339_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isRFC3339')};`;
  },
);

// isMilitaryTime — HH:MM 24시간 형식 (§4.8 B)

const MILITARY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isMilitaryTime = makeStringRule(
  'isMilitaryTime',
  (v) => MILITARY_TIME_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(MILITARY_TIME_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isMilitaryTime')};`;
  },
);

// isLatitude — string 또는 number, -90 ~ 90 (requiresType none)

function _checkLatitude(value: unknown): boolean {
  if (typeof value === 'number') {
    return value >= -90 && value <= 90;
  }
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (isNaN(n)) return false;
    if (String(n) !== value && value !== String(n)) {
      // extra chars check — parseFloat('90abc') = 90 but should fail
      if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
    }
    return n >= -90 && n <= 90;
  }
  return false;
}

const _isLatitude = (value: unknown): boolean => _checkLatitude(value);

(_isLatitude as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRef(_checkLatitude);
  return `if (!_refs[${i}](${varName})) ${ctx.fail('isLatitude')};`;
};
(_isLatitude as any).ruleName = 'isLatitude';
// requiresType = undefined — string|number 모두 처리

export const isLatitude = _isLatitude as EmittableRule;

// isLongitude — string 또는 number, -180 ~ 180 (requiresType none)

function _checkLongitude(value: unknown): boolean {
  if (typeof value === 'number') {
    return value >= -180 && value <= 180;
  }
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (isNaN(n)) return false;
    if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
    return n >= -180 && n <= 180;
  }
  return false;
}

const _isLongitude = (value: unknown): boolean => _checkLongitude(value);

(_isLongitude as any).emit = (varName: string, ctx: EmitContext): string => {
  const i = ctx.addRef(_checkLongitude);
  return `if (!_refs[${i}](${varName})) ${ctx.fail('isLongitude')};`;
};
(_isLongitude as any).ruleName = 'isLongitude';
// requiresType = undefined — string|number 모두 처리

export const isLongitude = _isLongitude as EmittableRule;

// isEthereumAddress — 0x + 40 hex chars (§4.8 B)

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isEthereumAddress = makeStringRule(
  'isEthereumAddress',
  (v) => ETH_ADDRESS_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(ETH_ADDRESS_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isEthereumAddress')};`;
  },
);

// isBtcAddress — P2PKH (1...), P2SH (3...), bech32 (bc1...) (§4.8 B)

const BTC_P2PKH_RE = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BTC_P2SH_RE  = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BTC_BECH32_RE = /^(bc1)[a-z0-9]{6,87}$/;

export const isBtcAddress = makeStringRule(
  'isBtcAddress',
  (v) => BTC_P2PKH_RE.test(v) || BTC_P2SH_RE.test(v) || BTC_BECH32_RE.test(v),
  (varName, ctx) => {
    const i1 = ctx.addRegex(BTC_P2PKH_RE);
    const i2 = ctx.addRegex(BTC_P2SH_RE);
    const i3 = ctx.addRegex(BTC_BECH32_RE);
    return `if (!_re[${i1}].test(${varName}) && !_re[${i2}].test(${varName}) && !_re[${i3}].test(${varName})) ${ctx.fail('isBtcAddress')};`;
  },
);

// isISO4217CurrencyCode — ISO 4217 통화 코드 집합 (§4.8 C: ref 기반)

const ISO4217_CODES = new Set([
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
  'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BOV',
  'BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF',
  'CHW','CLF','CLP','CNY','COP','COU','CRC','CUC','CUP','CVE',
  'CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD',
  'FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD',
  'HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK',
  'JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD',
  'KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL',
  'MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN',
  'MXV','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR',
  'PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD',
  'RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE',
  'SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS',
  'TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD',
  'USN','UYI','UYU','UYW','UZS','VED','VES','VND','VUV','WST',
  'XAF','XAG','XAU','XBA','XBB','XBC','XBD','XCD','XDR','XOF',
  'XPD','XPF','XPT','XSU','XTS','XUA','YER','ZAR','ZMW','ZWL',
]);

export const isISO4217CurrencyCode = makeStringRule(
  'isISO4217CurrencyCode',
  (v) => ISO4217_CODES.has(v),
  (varName, ctx) => {
    const i = ctx.addRef(ISO4217_CODES);
    return `if (!_refs[${i}].has(${varName})) ${ctx.fail('isISO4217CurrencyCode')};`;
  },
);

// isPhoneNumber — E.164 국제 전화번호 (§4.8 B)

const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;

export const isPhoneNumber = makeStringRule(
  'isPhoneNumber',
  (v) => PHONE_E164_RE.test(v),
  (varName, ctx) => {
    const i = ctx.addRegex(PHONE_E164_RE);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isPhoneNumber')};`;
  },
);

// isStrongPassword — 강력한 비밀번호 체크 (§4.8 C: factory)

export interface IsStrongPasswordOptions {
  minLength?: number;
  minLowercase?: number;
  minUppercase?: number;
  minNumbers?: number;
  minSymbols?: number;
}

export function isStrongPassword(options?: IsStrongPasswordOptions): EmittableRule {
  const minLength   = options?.minLength   ?? 8;
  const minLower    = options?.minLowercase ?? 1;
  const minUpper    = options?.minUppercase ?? 1;
  const minNums     = options?.minNumbers   ?? 1;
  const minSymbols  = options?.minSymbols   ?? 1;

  const validate = (v: string): boolean => {
    if (v.length < minLength) return false;
    if (minLower > 0) {
      const cnt = (v.match(/[a-z]/g) || []).length;
      if (cnt < minLower) return false;
    }
    if (minUpper > 0) {
      const cnt = (v.match(/[A-Z]/g) || []).length;
      if (cnt < minUpper) return false;
    }
    if (minNums > 0) {
      const cnt = (v.match(/[0-9]/g) || []).length;
      if (cnt < minNums) return false;
    }
    if (minSymbols > 0) {
      const cnt = (v.match(/[^a-zA-Z0-9]/g) || []).length;
      if (cnt < minSymbols) return false;
    }
    return true;
  };

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return validate(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(validate);
    return `if (!_refs[${i}](${varName})) ${ctx.fail('isStrongPassword')};`;
  };
  (fn as any).ruleName = 'isStrongPassword';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}

// isTaxId — 로케일별 세금 식별자 (§4.8 C: factory)

const TAX_ID_REGEXES: Record<string, RegExp> = {
  US: /^\d{2}-\d{7}$/,                      // EIN format: XX-XXXXXXX
  KR: /^\d{3}-\d{2}-\d{5}$/,                // 사업자등록번호: XXX-XX-XXXXX
  DE: /^\d{11}$/,                            // Steuernummer: 11자리
  FR: /^[0-9]{13}$/,                         // SIRET: 13자리
  GB: /^\d{10}$/,                            // UTR: 10자리
  IT: /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i, // Codice Fiscale
  ES: /^[0-9A-Z]\d{7}[0-9A-Z]$/i,           // NIF/NIE/CIF
  AU: /^\d{11}$/,                            // ABN: 11자리
  CA: /^\d{9}$/,                             // BN: 9자리
  IN: /^[A-Z]{5}\d{4}[A-Z]$/i,              // PAN: XXXXX9999X
};

export function isTaxId(locale: string): EmittableRule {
  const re = TAX_ID_REGEXES[locale];

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    if (!re) return false;
    return re.test(value);
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (!re) {
      return ctx.fail('isTaxId') + ';';
    }
    const i = ctx.addRegex(re);
    return `if (!_re[${i}].test(${varName})) ${ctx.fail('isTaxId')};`;
  };
  (fn as any).ruleName = 'isTaxId';
  (fn as any).requiresType = 'string';

  return fn as EmittableRule;
}
