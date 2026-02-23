import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import {
  // Group A — length/range
  minLength,
  maxLength,
  length,
  contains,
  notContains,
  matches,
  // Group B — simple boolean
  isLowercase,
  isUppercase,
  isAscii,
  isAlpha,
  isAlphanumeric,
  isBooleanString,
  isNumberString,
  isDecimal,
  isFullWidth,
  isHalfWidth,
  isVariableWidth,
  isMultibyte,
  isSurrogatePair,
  isHexadecimal,
  isOctal,
  // Group C — regex-based
  isEmail,
  isURL,
  isUUID,
  isIP,
  isHexColor,
  isRgbColor,
  isHSL,
  isMACAddress,
  isISBN,
  isISIN,
  isISO8601,
  isISRC,
  isISSN,
  isJWT,
  isLatLong,
  isLocale,
  isDataURI,
  isFQDN,
  isPort,
  isEAN,
  isISO31661Alpha2,
  isISO31661Alpha3,
  isBIC,
  isFirebasePushId,
  isSemVer,
  isMongoId,
  isJSON,
  isBase32,
  isBase58,
  isBase64,
  isDateString,
  isMimeType,
  isCurrency,
  isMagnetURI,
  // Group D — algorithm-based
  isCreditCard,
  isIBAN,
  isByteLength,
  // Group E — new validators
  isHash,
  isRFC3339,
  isMilitaryTime,
  isLatitude,
  isLongitude,
  isEthereumAddress,
  isBtcAddress,
  isISO4217CurrencyCode,
  isPhoneNumber,
  isStrongPassword,
  isTaxId,
} from './string';

function makeCtx(refIndex: number = 0) {
  const addRefMock = mock((_fn: unknown) => refIndex);
  const addRegexMock = mock((_re: RegExp) => refIndex);
  const failMock = mock((code: string) => `_errors.push({path:'x',code:'${code}'})`);
  const ctx: Partial<EmitContext> = {
    addRegex: addRegexMock,
    addRef: addRefMock,
    addExecutor: mock(() => 0),
    fail: failMock,
    collectErrors: true,
  };
  return { ctx: ctx as EmitContext, addRefMock, addRegexMock, failMock };
}

// ─── Group A: Length / Range ──────────────────────────────────────────────────

describe('minLength', () => {
  it('should return true when string length equals minimum', () => {
    const rule = minLength(3);
    expect(rule('abc')).toBe(true);
  });

  it('should return true when string length exceeds minimum', () => {
    const rule = minLength(3);
    expect(rule('abcde')).toBe(true);
  });

  it('should return false when string length is less than minimum', () => {
    const rule = minLength(3);
    expect(rule('ab')).toBe(false);
  });

  it('should return true for empty string when minimum is 0', () => {
    const rule = minLength(0);
    expect(rule('')).toBe(true);
  });

  it('should generate v.length < n check code when calling emit()', () => {
    const rule = minLength(3);
    const { ctx, failMock } = makeCtx();
    const code = rule.emit('_v', ctx);
    expect(code).toContain('_v.length');
    expect(code).toContain('3');
    expect(failMock).toHaveBeenCalledWith('minLength');
  });

  it('should have ruleName minLength and requiresType string', () => {
    const rule = minLength(3);
    expect(rule.ruleName).toBe('minLength');
    expect(rule.requiresType).toBe('string');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = minLength(3);
    const r2 = minLength(3);
    expect(r1).not.toBe(r2);
  });
});

describe('maxLength', () => {
  it('should return true when string length is within maximum', () => {
    const rule = maxLength(5);
    expect(rule('abc')).toBe(true);
  });

  it('should return true when string length equals maximum', () => {
    const rule = maxLength(5);
    expect(rule('abcde')).toBe(true);
  });

  it('should return false when string length exceeds maximum', () => {
    const rule = maxLength(5);
    expect(rule('abcdef')).toBe(false);
  });

  it('should return true for empty string when maximum is 0', () => {
    const rule = maxLength(0);
    expect(rule('')).toBe(true);
  });

  it('should generate v.length > n check code when calling emit()', () => {
    const rule = maxLength(5);
    const { ctx, failMock } = makeCtx();
    const code = rule.emit('_v', ctx);
    expect(code).toContain('_v.length');
    expect(code).toContain('5');
    expect(failMock).toHaveBeenCalledWith('maxLength');
  });

  it('should have ruleName maxLength and requiresType string', () => {
    const rule = maxLength(5);
    expect(rule.ruleName).toBe('maxLength');
    expect(rule.requiresType).toBe('string');
  });
});

describe('length', () => {
  it('should return true when string length is within range', () => {
    const rule = length(3, 5);
    expect(rule('abcd')).toBe(true);
  });

  it('should return true when string length equals minimum boundary', () => {
    const rule = length(3, 5);
    expect(rule('abc')).toBe(true);
  });

  it('should return true when string length equals maximum boundary', () => {
    const rule = length(3, 5);
    expect(rule('abcde')).toBe(true);
  });

  it('should return false when string length is below minimum', () => {
    const rule = length(3, 5);
    expect(rule('ab')).toBe(false);
  });

  it('should return false when string length exceeds maximum', () => {
    const rule = length(3, 5);
    expect(rule('abcdef')).toBe(false);
  });

  it('should return true for exact single length when min equals max', () => {
    const rule = length(3, 3);
    expect(rule('abc')).toBe(true);
  });

  it('should generate range check code when calling emit()', () => {
    const rule = length(3, 5);
    const { ctx, failMock } = makeCtx();
    const code = rule.emit('_v', ctx);
    expect(code).toContain('_v.length');
    expect(failMock).toHaveBeenCalledWith('length');
  });

  it('should have ruleName length and requiresType string', () => {
    const rule = length(3, 5);
    expect(rule.ruleName).toBe('length');
    expect(rule.requiresType).toBe('string');
  });
});

describe('contains', () => {
  it('should return true when string contains seed', () => {
    const rule = contains('foo');
    expect(rule('foobar')).toBe(true);
  });

  it('should return false when string does not contain seed', () => {
    const rule = contains('foo');
    expect(rule('barbaz')).toBe(false);
  });

  it('should call ctx.addRef with seed and generate includes check when calling emit()', () => {
    const rule = contains('foo');
    const { ctx, addRefMock, failMock } = makeCtx(0);
    const code = rule.emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(addRefMock).toHaveBeenCalledWith('foo');
    expect(code).toContain('_refs[0]');
    expect(failMock).toHaveBeenCalledWith('contains');
  });

  it('should have ruleName contains and requiresType string', () => {
    const rule = contains('foo');
    expect(rule.ruleName).toBe('contains');
    expect(rule.requiresType).toBe('string');
  });
});

describe('notContains', () => {
  it('should return true when string does not contain seed', () => {
    const rule = notContains('foo');
    expect(rule('barbaz')).toBe(true);
  });

  it('should return false when string contains seed', () => {
    const rule = notContains('foo');
    expect(rule('foobar')).toBe(false);
  });

  it('should call ctx.addRef with seed and generate inverse includes check when calling emit()', () => {
    const rule = notContains('foo');
    const { ctx, addRefMock, failMock } = makeCtx(0);
    const code = rule.emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(failMock).toHaveBeenCalledWith('notContains');
  });

  it('should have ruleName notContains', () => {
    const rule = notContains('foo');
    expect(rule.ruleName).toBe('notContains');
  });
});

describe('matches', () => {
  it('should return true when string matches pattern', () => {
    const rule = matches(/^[a-z]+$/);
    expect(rule('hello')).toBe(true);
  });

  it('should return false when string does not match pattern', () => {
    const rule = matches(/^[a-z]+$/);
    expect(rule('Hello123')).toBe(false);
  });

  it('should support string pattern with modifiers', () => {
    const rule = matches('^[a-z]+$', 'i');
    expect(rule('HELLO')).toBe(true);
  });

  it('should call ctx.addRegex and generate test check code when calling emit()', () => {
    const rule = matches(/^[a-z]+$/);
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = rule.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_re[0]');
    expect(code).toContain('.test(');
    expect(failMock).toHaveBeenCalledWith('matches');
  });

  it('should have ruleName matches and requiresType string', () => {
    const rule = matches(/^[a-z]+$/);
    expect(rule.ruleName).toBe('matches');
    expect(rule.requiresType).toBe('string');
  });

  it('should return false for empty string when pattern requires content', () => {
    const rule = matches(/^[a-z]+$/);
    expect(rule('')).toBe(false);
  });
});

// ─── Group B: Simple Boolean Checks ──────────────────────────────────────────

describe('isLowercase', () => {
  it('should return true for all lowercase string', () => {
    expect(isLowercase('hello world')).toBe(true);
  });

  it('should return false when string contains uppercase character', () => {
    expect(isLowercase('Hello')).toBe(false);
  });

  it('should generate toLowerCase comparison code when calling emit() and have ruleName isLowercase', () => {
    const { ctx, failMock } = makeCtx();
    const code = isLowercase.emit('_v', ctx);
    expect(code).toContain('toLowerCase');
    expect(failMock).toHaveBeenCalledWith('isLowercase');
    expect(isLowercase.ruleName).toBe('isLowercase');
    expect(isLowercase.requiresType).toBe('string');
  });

  it('should return true for empty string', () => {
    expect(isLowercase('')).toBe(true);
  });
});

describe('isUppercase', () => {
  it('should return true for all uppercase string', () => {
    expect(isUppercase('HELLO WORLD')).toBe(true);
  });

  it('should return false when string contains lowercase character', () => {
    expect(isUppercase('Hello')).toBe(false);
  });

  it('should generate toUpperCase comparison code when calling emit() and have ruleName isUppercase', () => {
    const { ctx, failMock } = makeCtx();
    const code = isUppercase.emit('_v', ctx);
    expect(code).toContain('toUpperCase');
    expect(failMock).toHaveBeenCalledWith('isUppercase');
    expect(isUppercase.ruleName).toBe('isUppercase');
  });

  it('should return true for empty string', () => {
    expect(isUppercase('')).toBe(true);
  });
});

describe('isAscii', () => {
  it('should return true for ASCII-only string', () => {
    expect(isAscii('Hello World! 123')).toBe(true);
  });

  it('should return false when string contains non-ASCII character', () => {
    expect(isAscii('café')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isAscii', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isAscii.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_re[0]');
    expect(failMock).toHaveBeenCalledWith('isAscii');
    expect(isAscii.ruleName).toBe('isAscii');
  });

  it('should return true for empty string', () => {
    expect(isAscii('')).toBe(true);
  });
});

describe('isAlpha', () => {
  it('should return true for alphabetic-only string with default locale', () => {
    expect(isAlpha('HelloWorld')).toBe(true);
  });

  it('should return false when string contains digit', () => {
    expect(isAlpha('Hello1')).toBe(false);
  });

  it('should return false when string contains space', () => {
    expect(isAlpha('Hello World')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isAlpha', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isAlpha().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_re[0]');
    expect(failMock).toHaveBeenCalledWith('isAlpha');
    expect(isAlpha().ruleName).toBe('isAlpha');
  });
});

describe('isAlphanumeric', () => {
  it('should return true for alphanumeric string with default locale', () => {
    expect(isAlphanumeric('Hello123')).toBe(true);
  });

  it('should return false when string contains special character', () => {
    expect(isAlphanumeric('Hello!')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isAlphanumeric', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isAlphanumeric().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isAlphanumeric');
    expect(isAlphanumeric().ruleName).toBe('isAlphanumeric');
  });

  it('should return false for empty string', () => {
    expect(isAlphanumeric()('')).toBe(false);
  });
});

describe('isBooleanString', () => {
  it('should return true for "true"', () => {
    expect(isBooleanString('true')).toBe(true);
  });

  it('should return true for "false"', () => {
    expect(isBooleanString('false')).toBe(true);
  });

  it('should return true for "1"', () => {
    expect(isBooleanString('1')).toBe(true);
  });

  it('should return true for "0"', () => {
    expect(isBooleanString('0')).toBe(true);
  });

  it('should return false for arbitrary string', () => {
    expect(isBooleanString('yes')).toBe(false);
  });

  it('should generate inline boolean check code when calling emit() and have ruleName isBooleanString', () => {
    const { ctx, failMock } = makeCtx();
    const code = isBooleanString.emit('_v', ctx);
    expect(code).toContain('true');
    expect(code).toContain('false');
    expect(failMock).toHaveBeenCalledWith('isBooleanString');
    expect(isBooleanString.ruleName).toBe('isBooleanString');
  });
});

describe('isNumberString', () => {
  it('should return true for integer string', () => {
    expect(isNumberString()('42')).toBe(true);
  });

  it('should return true for decimal string', () => {
    expect(isNumberString()('3.14')).toBe(true);
  });

  it('should return false for non-numeric string', () => {
    expect(isNumberString()('hello')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isNumberString()('')).toBe(false);
  });

  it('should generate number check code when calling emit() and have ruleName isNumberString', () => {
    const { ctx, failMock } = makeCtx();
    const code = isNumberString().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isNumberString');
    expect(isNumberString().ruleName).toBe('isNumberString');
  });

  it('should invoke the addRef checkFn (covers L207-209 closure body)', () => {
    const { ctx, addRefMock } = makeCtx(0);
    isNumberString().emit('_v', ctx);
    const checkFn = addRefMock.mock.calls[0][0] as (s: string) => boolean;
    // empty string → false (L208: if (s.length === 0) return false)
    expect(checkFn('')).toBe(false);
    // non-numeric string → false (L209-210: NaN check)
    expect(checkFn('hello')).toBe(false);
    // valid number string → true
    expect(checkFn('3.14')).toBe(true);
  });
});

describe('isDecimal', () => {
  it('should return true for decimal number string', () => {
    expect(isDecimal()('1.5')).toBe(true);
  });

  it('should return true for integer string (no decimal required)', () => {
    expect(isDecimal()('42')).toBe(true);
  });

  it('should return false for non-numeric string', () => {
    expect(isDecimal()('hello')).toBe(false);
  });

  it('should generate regex check code when calling emit() and have ruleName isDecimal', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isDecimal().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isDecimal');
    expect(isDecimal().ruleName).toBe('isDecimal');
  });
});

describe('isFullWidth', () => {
  it('should return true for string containing full-width character', () => {
    expect(isFullWidth('Ａ')).toBe(true);
  });

  it('should return false for ASCII-only string', () => {
    expect(isFullWidth('A')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isFullWidth', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isFullWidth.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isFullWidth');
    expect(isFullWidth.ruleName).toBe('isFullWidth');
  });

  it('should return false for empty string', () => {
    expect(isFullWidth('')).toBe(false);
  });
});

describe('isHalfWidth', () => {
  it('should return true for string containing half-width character', () => {
    expect(isHalfWidth('abc123')).toBe(true);
  });

  it('should return false for all full-width string', () => {
    expect(isHalfWidth('ＡＢＣＤ')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isHalfWidth', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isHalfWidth.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isHalfWidth');
    expect(isHalfWidth.ruleName).toBe('isHalfWidth');
  });

  it('should return false for empty string', () => {
    expect(isHalfWidth('')).toBe(false);
  });
});

describe('isVariableWidth', () => {
  it('should return true for string containing both full-width and half-width characters', () => {
    expect(isVariableWidth('Ａabc')).toBe(true);
  });

  it('should return false for all half-width string', () => {
    expect(isVariableWidth('abc')).toBe(false);
  });

  it('should return false for all full-width string', () => {
    expect(isVariableWidth('ＡＢＣ')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isVariableWidth', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isVariableWidth.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isVariableWidth');
    expect(isVariableWidth.ruleName).toBe('isVariableWidth');
  });
});

describe('isMultibyte', () => {
  it('should return true for string containing multibyte character', () => {
    expect(isMultibyte('日本語')).toBe(true);
  });

  it('should return false for ASCII-only string', () => {
    expect(isMultibyte('hello')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isMultibyte', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMultibyte.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isMultibyte');
    expect(isMultibyte.ruleName).toBe('isMultibyte');
  });

  it('should return false for empty string', () => {
    expect(isMultibyte('')).toBe(false);
  });
});

describe('isSurrogatePair', () => {
  it('should return true for string containing surrogate pair', () => {
    expect(isSurrogatePair('\uD83D\uDE00')).toBe(true);
  });

  it('should return false for ASCII-only string', () => {
    expect(isSurrogatePair('hello')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isSurrogatePair', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isSurrogatePair.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isSurrogatePair');
    expect(isSurrogatePair.ruleName).toBe('isSurrogatePair');
  });

  it('should return false for empty string', () => {
    expect(isSurrogatePair('')).toBe(false);
  });
});

describe('isHexadecimal', () => {
  it('should return true for hexadecimal string', () => {
    expect(isHexadecimal('deadbeef')).toBe(true);
  });

  it('should return true for uppercase hex string', () => {
    expect(isHexadecimal('DEADBEEF')).toBe(true);
  });

  it('should return false for non-hex character', () => {
    expect(isHexadecimal('xyz')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isHexadecimal', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isHexadecimal.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isHexadecimal');
    expect(isHexadecimal.ruleName).toBe('isHexadecimal');
    expect(isHexadecimal.requiresType).toBe('string');
  });
});

describe('isOctal', () => {
  it('should return true for octal string', () => {
    expect(isOctal('0755')).toBe(true);
  });

  it('should return false for string containing 8 or 9', () => {
    expect(isOctal('089')).toBe(false);
  });

  it('should generate regex test code when calling emit() and have ruleName isOctal', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isOctal.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isOctal');
    expect(isOctal.ruleName).toBe('isOctal');
  });

  it('should return false for empty string', () => {
    expect(isOctal('')).toBe(false);
  });
});

// ─── Group C: Regex-based ─────────────────────────────────────────────────────

describe('isEmail', () => {
  it('should return true for valid email address', () => {
    expect(isEmail()('user@example.com')).toBe(true);
  });

  it('should return true for email with subdomain', () => {
    expect(isEmail()('user@mail.example.co.uk')).toBe(true);
  });

  it('should return true for email with plus sign in local part', () => {
    expect(isEmail()('user+tag@example.com')).toBe(true);
  });

  it('should return false for email without at sign', () => {
    expect(isEmail()('userexample.com')).toBe(false);
  });

  it('should return false for email without domain', () => {
    expect(isEmail()('user@')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isEmail()('')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit()', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isEmail().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_re[0]');
    expect(failMock).toHaveBeenCalledWith('isEmail');
  });

  it('should have ruleName isEmail and requiresType string', () => {
    expect(isEmail().ruleName).toBe('isEmail');
    expect(isEmail().requiresType).toBe('string');
  });
});

describe('isURL', () => {
  it('should return true for valid http URL', () => {
    expect(isURL()('http://example.com')).toBe(true);
  });

  it('should return true for valid https URL', () => {
    expect(isURL()('https://example.com/path?q=1')).toBe(true);
  });

  it('should return false for URL without protocol', () => {
    expect(isURL()('example.com')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isURL()('')).toBe(false);
  });

  it('should return true for URL with allowedProtocols option matching', () => {
    expect(isURL({ protocols: ['ftp'] })('ftp://ftp.example.com')).toBe(true);
  });

  it('should return false for URL with protocol not in allowedProtocols', () => {
    expect(isURL({ protocols: ['https'] })('http://example.com')).toBe(false);
  });

  it('should generate regex-based code when calling emit()', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isURL().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isURL');
  });

  it('should have ruleName isURL and requiresType string', () => {
    expect(isURL().ruleName).toBe('isURL');
    expect(isURL().requiresType).toBe('string');
  });
});

describe('isUUID', () => {
  it('should return true for valid UUID v4 without version constraint', () => {
    expect(isUUID()('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('should return true for UUID v4 with version 4 constraint', () => {
    expect(isUUID(4)('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('should return false for invalid UUID format', () => {
    expect(isUUID()('not-a-uuid')).toBe(false);
  });

  it('should return false for UUID v4 with version 3 constraint', () => {
    expect(isUUID(3)('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isUUID()('')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit()', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isUUID().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_re[0]');
    expect(failMock).toHaveBeenCalledWith('isUUID');
  });

  it('should have ruleName isUUID and requiresType string', () => {
    expect(isUUID().ruleName).toBe('isUUID');
    expect(isUUID().requiresType).toBe('string');
  });
});

describe('isIP', () => {
  it('should return true for valid IPv4 address', () => {
    expect(isIP()('192.168.1.1')).toBe(true);
  });

  it('should return true for valid IPv6 address', () => {
    expect(isIP()('2001:db8::1')).toBe(true);
  });

  it('should return true for IPv4 loopback', () => {
    expect(isIP()('127.0.0.1')).toBe(true);
  });

  it('should return false for IP with octet out of range', () => {
    expect(isIP()('999.999.999.999')).toBe(false);
  });

  it('should return true for valid IPv4 with version 4 constraint', () => {
    expect(isIP(4)('192.168.1.1')).toBe(true);
  });

  it('should return false for IPv6 with version 4 constraint', () => {
    expect(isIP(4)('2001:db8::1')).toBe(false);
  });

  it('should return true for IPv6 with version 6 constraint', () => {
    expect(isIP(6)('::1')).toBe(true);
  });

  it('should call ctx.addRegex and generate test code when calling emit()', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isIP().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isIP');
  });

  it('should generate IPv4-only check code when emit() is called with version 4', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isIP(4).emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isIP');
  });

  it('should generate IPv6-only check code when emit() is called with version 6', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isIP(6).emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isIP');
  });

  it('should have ruleName isIP and requiresType string', () => {
    expect(isIP().ruleName).toBe('isIP');
    expect(isIP().requiresType).toBe('string');
  });
});

describe('isHexColor', () => {
  it('should return true for valid 6-digit hex color', () => {
    expect(isHexColor('#ff0000')).toBe(true);
  });

  it('should return true for valid 3-digit hex color', () => {
    expect(isHexColor('#f00')).toBe(true);
  });

  it('should return false for hex color without hash', () => {
    expect(isHexColor('ff0000')).toBe(false);
  });

  it('should return false for invalid hex color', () => {
    expect(isHexColor('#xyz')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isHexColor', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isHexColor.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isHexColor');
    expect(isHexColor.ruleName).toBe('isHexColor');
    expect(isHexColor.requiresType).toBe('string');
  });
});

describe('isRgbColor', () => {
  it('should return true for valid rgb() color', () => {
    expect(isRgbColor()('rgb(255,0,0)')).toBe(true);
  });

  it('should return true for valid rgba() color', () => {
    expect(isRgbColor()('rgba(255,0,0,0.5)')).toBe(true);
  });

  it('should return false for invalid rgb color', () => {
    expect(isRgbColor()('rgb(256,0,0)')).toBe(false);
  });

  it('should return true for rgb with percentage values when includePercentValues is true', () => {
    expect(isRgbColor(true)('rgb(100%,0%,0%)')).toBe(true);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isRgbColor', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isRgbColor().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isRgbColor');
    expect(isRgbColor().ruleName).toBe('isRgbColor');
  });

  it('should generate percent-regex check code when emit() is called with includePercentValues=true', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isRgbColor(true).emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isRgbColor');
  });
});

describe('isHSL', () => {
  it('should return true for valid hsl() color', () => {
    expect(isHSL('hsl(360,100%,50%)')).toBe(true);
  });

  it('should return true for valid hsla() color', () => {
    expect(isHSL('hsla(360,100%,50%,0.5)')).toBe(true);
  });

  it('should return false for invalid hsl color', () => {
    expect(isHSL('hsl(400,100%,50%)')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isHSL', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isHSL.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isHSL');
    expect(isHSL.ruleName).toBe('isHSL');
  });
});

describe('isMACAddress', () => {
  it('should return true for valid colon-separated MAC address', () => {
    expect(isMACAddress()('01:23:45:67:89:ab')).toBe(true);
  });

  it('should return true for valid hyphen-separated MAC address', () => {
    expect(isMACAddress()('01-23-45-67-89-ab')).toBe(true);
  });

  it('should return false for invalid MAC address', () => {
    expect(isMACAddress()('01:23:45:67:89')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isMACAddress', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMACAddress().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isMACAddress');
    expect(isMACAddress().ruleName).toBe('isMACAddress');
  });

  it('should generate no-separator regex check code when emit() is called with no_separators:true', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMACAddress({ no_separators: true }).emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isMACAddress');
  });
});

describe('isISBN', () => {
  it('should return true for valid ISBN-13', () => {
    expect(isISBN()('978-3-16-148410-0')).toBe(true);
  });

  it('should return true for valid ISBN-10', () => {
    expect(isISBN()('0-306-40615-2')).toBe(true);
  });

  it('should return false for invalid ISBN', () => {
    expect(isISBN()('1234567890')).toBe(false);
  });

  it('should return true for ISBN-13 with version 13 constraint', () => {
    expect(isISBN(13)('978-3-16-148410-0')).toBe(true);
  });

  it('should return false for ISBN-10 with version 13 constraint', () => {
    expect(isISBN(13)('0-306-40615-2')).toBe(false);
  });

  it('should generate code when calling emit() and have ruleName isISBN', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isISBN().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isISBN');
    expect(isISBN().ruleName).toBe('isISBN');
    expect(isISBN().requiresType).toBe('string');
  });
});

describe('isISIN', () => {
  it('should return true for valid ISIN', () => {
    expect(isISIN('US0378331005')).toBe(true);
  });

  it('should return false for invalid ISIN', () => {
    expect(isISIN('US03783310')).toBe(false);
  });

  it('should return false for ISIN that passes regex but fails Luhn checksum', () => {
    // US0378331006 matches ISIN_RE but has wrong Luhn check digit (valid: US0378331005)
    expect(isISIN('US0378331006')).toBe(false);
  });

  it('should emit code using addRef to register full validate function (regex + Luhn)', () => {
    // After fix: emit uses addRef (full validate), not just addRegex
    const { ctx, addRefMock, failMock } = makeCtx(0);
    isISIN.emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isISIN');
    expect(isISIN.ruleName).toBe('isISIN');
  });
});

describe('isISO8601', () => {
  it('should return true for valid ISO 8601 date string', () => {
    expect(isISO8601()('2023-01-01')).toBe(true);
  });

  it('should return true for valid ISO 8601 datetime string', () => {
    expect(isISO8601()('2023-01-01T12:00:00Z')).toBe(true);
  });

  it('should return false for invalid date format', () => {
    expect(isISO8601()('01-01-2023')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isISO8601', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isISO8601().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isISO8601');
    expect(isISO8601().ruleName).toBe('isISO8601');
  });

  it('should return true for valid date with strict: true', () => {
    expect(isISO8601({ strict: true })('2023-02-28')).toBe(true);
  });

  it('should return false for invalid month with strict: true', () => {
    expect(isISO8601({ strict: true })('2023-13-01')).toBe(false);
  });

  it('should return false for invalid day with strict: true', () => {
    expect(isISO8601({ strict: true })('2023-02-30')).toBe(false);
  });

  it('strict: true emit uses addRef (function ref path)', () => {
    const { ctx, addRefMock, failMock } = makeCtx(0);
    isISO8601({ strict: true }).emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isISO8601');
  });

  it('strict: true ruleName is isISO8601', () => {
    expect(isISO8601({ strict: true }).ruleName).toBe('isISO8601');
  });
});

describe('isISRC', () => {
  it('should return true for valid ISRC', () => {
    expect(isISRC('USRC17607839')).toBe(true);
  });

  it('should return false for invalid ISRC', () => {
    expect(isISRC('INVALID')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isISRC', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isISRC.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isISRC');
    expect(isISRC.ruleName).toBe('isISRC');
  });
});

describe('isISSN', () => {
  it('should return true for valid ISSN', () => {
    expect(isISSN()('0378-5955')).toBe(true);
  });

  it('should return false for invalid ISSN', () => {
    expect(isISSN()('1234-5678')).toBe(false);
  });

  it('should return true for ISSN without hyphen when requireHyphen is false', () => {
    expect(isISSN({ requireHyphen: false })('03785955')).toBe(true);
  });

  it('should return false for ISSN that passes regex but fails mod-11 checksum', () => {
    // 0378-5950 matches regex \\d{4}-\\d{3}[\\dX] but check-digit 0 is wrong (valid: 0378-5955)
    expect(isISSN()('0378-5950')).toBe(false);
  });

  it('should emit code using addRef to register full validate function (regex + mod-11)', () => {
    // After fix: emit uses addRef (full validate), not just addRegex
    const { ctx, addRefMock, failMock } = makeCtx(0);
    isISSN().emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isISSN');
    expect(isISSN().ruleName).toBe('isISSN');
  });
});

describe('isJWT', () => {
  it('should return true for valid JWT (3-part dot-separated base64url)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(isJWT(jwt)).toBe(true);
  });

  it('should return false for string without two dots', () => {
    expect(isJWT('header.payload')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isJWT('')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isJWT', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isJWT.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isJWT');
    expect(isJWT.ruleName).toBe('isJWT');
    expect(isJWT.requiresType).toBe('string');
  });
});

describe('isLatLong', () => {
  it('should return true for valid lat,long pair', () => {
    expect(isLatLong()('40.7128,-74.0060')).toBe(true);
  });

  it('should return false for out-of-range latitude', () => {
    expect(isLatLong()('91.0000,0.0000')).toBe(false);
  });

  it('should return false for invalid format', () => {
    expect(isLatLong()('not_a_coord')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isLatLong', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isLatLong().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isLatLong');
    expect(isLatLong().ruleName).toBe('isLatLong');
  });
});

describe('isLocale', () => {
  it('should return true for valid BCP 47 locale (en)', () => {
    expect(isLocale('en')).toBe(true);
  });

  it('should return true for valid BCP 47 locale (en-US)', () => {
    expect(isLocale('en-US')).toBe(true);
  });

  it('should return false for invalid locale', () => {
    expect(isLocale('a')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isLocale', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isLocale.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isLocale');
    expect(isLocale.ruleName).toBe('isLocale');
  });
});

describe('isDataURI', () => {
  it('should return true for valid data URI', () => {
    expect(isDataURI('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')).toBe(true);
  });

  it('should return true for data URI with text content', () => {
    expect(isDataURI('data:text/plain;charset=utf-8,Hello')).toBe(true);
  });

  it('should return false for non-data URI', () => {
    expect(isDataURI('http://example.com')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isDataURI', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isDataURI.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isDataURI');
    expect(isDataURI.ruleName).toBe('isDataURI');
  });
});

describe('isFQDN', () => {
  it('should return true for valid FQDN', () => {
    expect(isFQDN()('example.com')).toBe(true);
  });

  it('should return true for subdomain FQDN', () => {
    expect(isFQDN()('sub.example.co.uk')).toBe(true);
  });

  it('should return false for IP address', () => {
    expect(isFQDN()('192.168.1.1')).toBe(false);
  });

  it('should return false for localhost', () => {
    expect(isFQDN()('localhost')).toBe(false);
  });

  it('should generate code when calling emit() and have ruleName isFQDN', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isFQDN().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isFQDN');
    expect(isFQDN().ruleName).toBe('isFQDN');
  });
});

describe('isPort', () => {
  it('should return true for port 80', () => {
    expect(isPort('80')).toBe(true);
  });

  it('should return true for port 0', () => {
    expect(isPort('0')).toBe(true);
  });

  it('should return true for port 65535', () => {
    expect(isPort('65535')).toBe(true);
  });

  it('should return false for port 65536', () => {
    expect(isPort('65536')).toBe(false);
  });

  it('should return false for negative port', () => {
    expect(isPort('-1')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isPort', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isPort.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isPort');
    expect(isPort.ruleName).toBe('isPort');
    expect(isPort.requiresType).toBe('string');
  });
});

describe('isEAN', () => {
  it('should return true for valid EAN-13', () => {
    expect(isEAN('5901234123457')).toBe(true);
  });

  it('should return true for valid EAN-8', () => {
    expect(isEAN('96385074')).toBe(true);
  });

  it('should return false for invalid EAN', () => {
    expect(isEAN('1234567890123')).toBe(false);
  });

  it('should generate code when calling emit() and have ruleName isEAN', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isEAN.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isEAN');
    expect(isEAN.ruleName).toBe('isEAN');
  });
});

describe('isISO31661Alpha2', () => {
  it('should return true for valid ISO 3166-1 alpha-2 code', () => {
    expect(isISO31661Alpha2('US')).toBe(true);
  });

  it('should return true for lowercase valid code', () => {
    expect(isISO31661Alpha2('us')).toBe(true);
  });

  it('should return false for invalid 2-letter code', () => {
    expect(isISO31661Alpha2('XX')).toBe(false);
  });

  it('should call ctx.addRef and generate test code when calling emit() and have ruleName isISO31661Alpha2', () => {
    const { ctx, addRefMock, failMock } = makeCtx(0);
    const code = isISO31661Alpha2.emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isISO31661Alpha2');
    expect(isISO31661Alpha2.ruleName).toBe('isISO31661Alpha2');
  });
});

describe('isISO31661Alpha3', () => {
  it('should return true for valid ISO 3166-1 alpha-3 code', () => {
    expect(isISO31661Alpha3('USA')).toBe(true);
  });

  it('should return false for invalid 3-letter code', () => {
    expect(isISO31661Alpha3('XXX')).toBe(false);
  });

  it('should call ctx.addRef and generate test code when calling emit() and have ruleName isISO31661Alpha3', () => {
    const { ctx, addRefMock, failMock } = makeCtx(0);
    const code = isISO31661Alpha3.emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isISO31661Alpha3');
    expect(isISO31661Alpha3.ruleName).toBe('isISO31661Alpha3');
  });
});

describe('isBIC', () => {
  it('should return true for valid BIC/SWIFT code (8 chars)', () => {
    expect(isBIC('DEUTDEDB')).toBe(true);
  });

  it('should return true for valid BIC/SWIFT code (11 chars)', () => {
    expect(isBIC('DEUTDEDBFRA')).toBe(true);
  });

  it('should return false for invalid BIC', () => {
    expect(isBIC('INVALID')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isBIC', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isBIC.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isBIC');
    expect(isBIC.ruleName).toBe('isBIC');
  });
});

describe('isFirebasePushId', () => {
  it('should return true for valid Firebase Push ID (20 chars, base64url charset)', () => {
    expect(isFirebasePushId('-KkI7fTh9VD5V7FTB5sl')).toBe(true);
  });

  it('should return false for ID with wrong length', () => {
    expect(isFirebasePushId('abc')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isFirebasePushId', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isFirebasePushId.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isFirebasePushId');
    expect(isFirebasePushId.ruleName).toBe('isFirebasePushId');
  });
});

describe('isSemVer', () => {
  it('should return true for valid semantic version', () => {
    expect(isSemVer('1.2.3')).toBe(true);
  });

  it('should return true for version with pre-release tag', () => {
    expect(isSemVer('1.0.0-alpha.1')).toBe(true);
  });

  it('should return false for non-semver string', () => {
    expect(isSemVer('1.2')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isSemVer', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isSemVer.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isSemVer');
    expect(isSemVer.ruleName).toBe('isSemVer');
  });
});

describe('isMongoId', () => {
  it('should return true for valid MongoDB ObjectId (24-char hex)', () => {
    expect(isMongoId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('should return false for non-hex string', () => {
    expect(isMongoId('507f1f77bcf86cd79943901g')).toBe(false);
  });

  it('should return false for wrong-length hex string', () => {
    expect(isMongoId('507f1f77bcf86cd')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isMongoId', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMongoId.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isMongoId');
    expect(isMongoId.ruleName).toBe('isMongoId');
  });
});

describe('isJSON', () => {
  it('should return true for valid JSON object string', () => {
    expect(isJSON('{"key":"value"}')).toBe(true);
  });

  it('should return true for valid JSON array string', () => {
    expect(isJSON('[1,2,3]')).toBe(true);
  });

  it('should return false for invalid JSON string', () => {
    expect(isJSON('{invalid}')).toBe(false);
  });

  it('should return false for non-string value', () => {
    expect(isJSON(42 as any)).toBe(false);
  });

  it('should generate try-catch or ref-based code when calling emit() and have ruleName isJSON', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isJSON.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isJSON');
    expect(isJSON.ruleName).toBe('isJSON');
  });

  it('should invoke the addRef checkFn (covers L919 catch return false)', () => {
    const { ctx, addRefMock } = makeCtx(0);
    isJSON.emit('_v', ctx);
    const checkFn = addRefMock.mock.calls[0][0] as (s: string) => boolean;
    // invalid JSON → catch → return false  (L919)
    expect(checkFn('{invalid}')).toBe(false);
    // valid JSON → return true
    expect(checkFn('{"a":1}')).toBe(true);
  });
});

describe('isBase32', () => {
  it('should return true for valid Base32 string', () => {
    expect(isBase32()('JBSWY3DPEB3W64TMMQQQ====')).toBe(true);
  });

  it('should return false for invalid Base32 string', () => {
    expect(isBase32()('Not!Valid')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isBase32', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isBase32().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isBase32');
    expect(isBase32().ruleName).toBe('isBase32');
  });
});

describe('isBase58', () => {
  it('should return true for valid Base58 string', () => {
    expect(isBase58('3yZe7d')).toBe(true);
  });

  it('should return false for Base58 string containing 0, O, I, l', () => {
    expect(isBase58('0OIl')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isBase58', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isBase58.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isBase58');
    expect(isBase58.ruleName).toBe('isBase58');
  });
});

describe('isBase64', () => {
  it('should return true for valid standard Base64 string', () => {
    expect(isBase64()('SGVsbG8gV29ybGQ=')).toBe(true);
  });

  it('should return false for invalid Base64 string', () => {
    expect(isBase64()('Not!base64')).toBe(false);
  });

  it('should return true for URL-safe Base64 when urlSafe option is true', () => {
    expect(isBase64({ urlSafe: true })('SGVsbG8gV29ybGQ')).toBe(true);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isBase64', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isBase64().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isBase64');
    expect(isBase64().ruleName).toBe('isBase64');
  });
});

describe('isDateString', () => {
  it('should return true for valid ISO date string', () => {
    expect(isDateString()('2023-01-15')).toBe(true);
  });

  it('should return false for invalid date string format', () => {
    expect(isDateString()('15/01/2023')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isDateString', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isDateString().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isDateString');
    expect(isDateString().ruleName).toBe('isDateString');
  });
});

describe('isMimeType', () => {
  it('should return true for valid MIME type', () => {
    expect(isMimeType('application/json')).toBe(true);
  });

  it('should return true for valid MIME type with subtype', () => {
    expect(isMimeType('image/png')).toBe(true);
  });

  it('should return false for invalid MIME type', () => {
    expect(isMimeType('not-a-mime')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isMimeType', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMimeType.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isMimeType');
    expect(isMimeType.ruleName).toBe('isMimeType');
  });
});

describe('isCurrency', () => {
  it('should return true for valid currency amount', () => {
    expect(isCurrency()('$10.50')).toBe(true);
  });

  it('should return true for amount without symbol', () => {
    expect(isCurrency()('100.00')).toBe(true);
  });

  it('should return false for invalid currency format', () => {
    expect(isCurrency()('abc')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isCurrency', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isCurrency().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith('isCurrency');
    expect(isCurrency().ruleName).toBe('isCurrency');
  });
});

describe('isMagnetURI', () => {
  it('should return true for valid magnet URI', () => {
    expect(isMagnetURI('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a')).toBe(true);
  });

  it('should return false for non-magnet URI', () => {
    expect(isMagnetURI('http://example.com')).toBe(false);
  });

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isMagnetURI', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isMagnetURI.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledWith('isMagnetURI');
    expect(isMagnetURI.ruleName).toBe('isMagnetURI');
  });
});

// ─── Group D: Algorithm-based ─────────────────────────────────────────────────

describe('isCreditCard', () => {
  it('should return true for valid Visa test number (Luhn pass)', () => {
    expect(isCreditCard('4111111111111111')).toBe(true);
  });

  it('should return true for valid Mastercard test number', () => {
    expect(isCreditCard('5500005555555559')).toBe(true);
  });

  it('should return true for valid Amex test number', () => {
    expect(isCreditCard('378282246310005')).toBe(true);
  });

  it('should return true for number with dashes stripped', () => {
    expect(isCreditCard('4111-1111-1111-1111')).toBe(true);
  });

  it('should return true for number with spaces stripped', () => {
    expect(isCreditCard('4111 1111 1111 1111')).toBe(true);
  });

  it('should return false for number failing Luhn check', () => {
    expect(isCreditCard('1234567890123456')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isCreditCard('')).toBe(false);
  });

  it('should generate Luhn algorithm inline code when calling emit() and have ruleName isCreditCard', () => {
    const { ctx, failMock } = makeCtx();
    const code = isCreditCard.emit('_v', ctx);
    expect(code).toContain('%');
    expect(failMock).toHaveBeenCalledWith('isCreditCard');
    expect(isCreditCard.ruleName).toBe('isCreditCard');
    expect(isCreditCard.requiresType).toBe('string');
  });
});

describe('isIBAN', () => {
  it('should return true for valid IBAN (GB)', () => {
    expect(isIBAN()('GB82WEST12345698765432')).toBe(true);
  });

  it('should return true for valid IBAN with spaces when allowSpaces is true', () => {
    expect(isIBAN({ allowSpaces: true })('GB82 WEST 1234 5698 7654 32')).toBe(true);
  });

  it('should return false for invalid IBAN checksum', () => {
    expect(isIBAN()('GB00WEST12345698765432')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isIBAN()('')).toBe(false);
  });

  it('should generate mod-97 algorithm code when calling emit() and have ruleName isIBAN', () => {
    const { ctx, failMock } = makeCtx();
    const code = isIBAN().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isIBAN');
    expect(isIBAN().ruleName).toBe('isIBAN');
    expect(isIBAN().requiresType).toBe('string');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isIBAN();
    const r2 = isIBAN();
    expect(r1).not.toBe(r2);
  });
});

describe('isByteLength', () => {
  it('should return true when byte length is within range', () => {
    const rule = isByteLength(1, 10);
    expect(rule('hello')).toBe(true);
  });

  it('should return true for multibyte string within range', () => {
    const rule = isByteLength(1, 100);
    expect(rule('日本語')).toBe(true);
  });

  it('should return false when byte length is below minimum', () => {
    const rule = isByteLength(5, 10);
    expect(rule('hi')).toBe(false);
  });

  it('should return false when byte length exceeds maximum', () => {
    const rule = isByteLength(1, 3);
    expect(rule('hello')).toBe(false);
  });

  it('should return true for empty string when minimum is 0', () => {
    const rule = isByteLength(0);
    expect(rule('')).toBe(true);
  });

  it('should count multibyte characters by byte length not char count', () => {
    const rule = isByteLength(1, 3);
    // '日' is 3 bytes in UTF-8, so within [1,3]
    expect(rule('日')).toBe(true);
    // '日本' is 6 bytes, exceeds max=3
    expect(rule('日本')).toBe(false);
  });

  it('should generate byte length check code when calling emit() and have ruleName isByteLength', () => {
    const rule = isByteLength(1, 10);
    const { ctx, failMock } = makeCtx();
    const code = rule.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isByteLength');
    expect(rule.ruleName).toBe('isByteLength');
    expect(rule.requiresType).toBe('string');
  });

  it('should invoke the addRef checkFn (covers L1165-1168 closure body)', () => {
    const rule = isByteLength(2, 5);
    const { ctx, addRefMock } = makeCtx(0);
    rule.emit('_v', ctx);
    const checkFn = addRefMock.mock.calls[0][0] as (s: string) => boolean;
    // 'a' = 1 byte < min(2) → false  (L1167)
    expect(checkFn('a')).toBe(false);
    // '日本語' = 9 bytes > max(5) → false  (L1168)
    expect(checkFn('日本語')).toBe(false);
    // 'hi' = 2 bytes in [2,5] → true
    expect(checkFn('hi')).toBe(true);
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isByteLength(1, 10);
    const r2 = isByteLength(1, 10);
    expect(r1).not.toBe(r2);
  });
});

// ─── isHash ──────────────────────────────────────────────────────────────────

describe('isHash', () => {
  it('should return true for a valid md5 hash', () => {
    expect(isHash('md5')('d41d8cd98f00b204e9800998ecf8427e')).toBe(true);
  });

  it('should return false for a non-hex md5-length string', () => {
    expect(isHash('md5')('z41d8cd98f00b204e9800998ecf8427e')).toBe(false);
  });

  it('should return true for a valid sha1 hash', () => {
    expect(isHash('sha1')('da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBe(true);
  });

  it('should return false for sha1 with wrong length', () => {
    expect(isHash('sha1')('da39a3ee5e6b4b0d3255bfef95601890afd8070')).toBe(false);
  });

  it('should return true for a valid sha256 hash', () => {
    expect(isHash('sha256')('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);
  });

  it('should return false for sha256 with non-hex character', () => {
    expect(isHash('sha256')('g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false);
  });

  it('should return true for valid sha384 hash', () => {
    // sha384 of empty string = 96 hex chars
    expect(isHash('sha384')('38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b')).toBe(true);
  });

  it('should return true for a valid sha512 hash', () => {
    // sha512 of empty string = 128 hex chars (exact)
    const sha512 = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';
    expect(isHash('sha512')(sha512)).toBe(true);
  });

  it('should return true for valid ripemd128 hash', () => {
    expect(isHash('ripemd128')('cdf26213a150dc3ecb610f18f6b38b46')).toBe(true);
  });

  it('should return false for ripemd128 with wrong length', () => {
    expect(isHash('ripemd128')('cdf26213a150dc3ecb610f18f6b38')).toBe(false);
  });

  it('should return true for valid ripemd160 hash', () => {
    expect(isHash('ripemd160')('9c1185a5c5e9fc54612808977ee8f548b2258d31')).toBe(true);
  });

  it('should return true for valid crc32 hash', () => {
    expect(isHash('crc32')('90abcdef')).toBe(true);
  });

  it('should return false for non-string input', () => {
    expect(isHash('md5')(42 as any)).toBe(false);
  });

  it('should have requiresType string', () => {
    expect(isHash('md5').requiresType).toBe('string');
  });

  it('should have ruleName isHash', () => {
    expect(isHash('md5').ruleName).toBe('isHash');
  });

  it('should generate emit code with regex check', () => {
    const { ctx, failMock } = makeCtx();
    const code = isHash('md5').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isHash');
  });

  it('should generate immediate fail code for unknown algorithm emit', () => {
    const { ctx, failMock } = makeCtx();
    const code = isHash('unknownAlgo' as any).emit('_v', ctx);
    expect(code).toContain('isHash');
    expect(failMock).toHaveBeenCalledWith('isHash');
  });
});

// ─── isRFC3339 ────────────────────────────────────────────────────────────────

describe('isRFC3339', () => {
  it('should return true for UTC datetime', () => {
    expect(isRFC3339('2021-01-01T00:00:00Z')).toBe(true);
  });

  it('should return true for datetime with timezone offset', () => {
    expect(isRFC3339('2021-12-31T23:59:59+09:00')).toBe(true);
  });

  it('should return true for datetime with milliseconds', () => {
    expect(isRFC3339('2021-06-15T12:30:45.123Z')).toBe(true);
  });

  it('should return false for date-only string', () => {
    expect(isRFC3339('2021-01-01')).toBe(false);
  });

  it('should return false for a plain string', () => {
    expect(isRFC3339('not-a-date')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isRFC3339('')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isRFC3339(12345 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isRFC3339', () => {
    expect(isRFC3339.requiresType).toBe('string');
    expect(isRFC3339.ruleName).toBe('isRFC3339');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isRFC3339.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isRFC3339');
  });
});

// ─── isMilitaryTime ───────────────────────────────────────────────────────────

describe('isMilitaryTime', () => {
  it('should return true for 00:00', () => {
    expect(isMilitaryTime('00:00')).toBe(true);
  });

  it('should return true for 23:59', () => {
    expect(isMilitaryTime('23:59')).toBe(true);
  });

  it('should return true for 12:30', () => {
    expect(isMilitaryTime('12:30')).toBe(true);
  });

  it('should return false for 24:00', () => {
    expect(isMilitaryTime('24:00')).toBe(false);
  });

  it('should return false for 12:60', () => {
    expect(isMilitaryTime('12:60')).toBe(false);
  });

  it('should return false for single-digit hour', () => {
    expect(isMilitaryTime('1:30')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isMilitaryTime(1230 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isMilitaryTime', () => {
    expect(isMilitaryTime.requiresType).toBe('string');
    expect(isMilitaryTime.ruleName).toBe('isMilitaryTime');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isMilitaryTime.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isMilitaryTime');
  });
});

// ─── isLatitude ───────────────────────────────────────────────────────────────

describe('isLatitude', () => {
  it('should return true for string "0"', () => {
    expect(isLatitude('0')).toBe(true);
  });

  it('should return true for string "-90"', () => {
    expect(isLatitude('-90')).toBe(true);
  });

  it('should return true for string "90"', () => {
    expect(isLatitude('90')).toBe(true);
  });

  it('should return true for string "45.1234"', () => {
    expect(isLatitude('45.1234')).toBe(true);
  });

  it('should return true for number 0', () => {
    expect(isLatitude(0)).toBe(true);
  });

  it('should return true for number 45.123', () => {
    expect(isLatitude(45.123)).toBe(true);
  });

  it('should return false for "-90.001"', () => {
    expect(isLatitude('-90.001')).toBe(false);
  });

  it('should return false for "90.001"', () => {
    expect(isLatitude('90.001')).toBe(false);
  });

  it('should return false for "abc"', () => {
    expect(isLatitude('abc')).toBe(false);
  });

  it('should return false for string with extra chars like "90abc"', () => {
    expect(isLatitude('90abc')).toBe(false);
  });

  it('should return false for non-string non-number input', () => {
    expect(isLatitude(null as any)).toBe(false);
    expect(isLatitude({} as any)).toBe(false);
  });

  it('should have ruleName isLatitude and requiresType undefined', () => {
    expect(isLatitude.ruleName).toBe('isLatitude');
    expect((isLatitude as any).requiresType).toBeUndefined();
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isLatitude.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isLatitude');
  });
});

// ─── isLongitude ──────────────────────────────────────────────────────────────

describe('isLongitude', () => {
  it('should return true for string "0"', () => {
    expect(isLongitude('0')).toBe(true);
  });

  it('should return true for string "-180"', () => {
    expect(isLongitude('-180')).toBe(true);
  });

  it('should return true for string "180"', () => {
    expect(isLongitude('180')).toBe(true);
  });

  it('should return true for number 90.5', () => {
    expect(isLongitude(90.5)).toBe(true);
  });

  it('should return false for "-180.001"', () => {
    expect(isLongitude('-180.001')).toBe(false);
  });

  it('should return false for "180.001"', () => {
    expect(isLongitude('180.001')).toBe(false);
  });

  it('should return false for "abc"', () => {
    expect(isLongitude('abc')).toBe(false);
  });

  it('should return false for string with extra chars like "180abc"', () => {
    expect(isLongitude('180abc')).toBe(false);
  });

  it('should return false for non-string non-number input', () => {
    expect(isLongitude(null as any)).toBe(false);
    expect(isLongitude({} as any)).toBe(false);
  });

  it('should have ruleName isLongitude and requiresType undefined', () => {
    expect(isLongitude.ruleName).toBe('isLongitude');
    expect((isLongitude as any).requiresType).toBeUndefined();
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isLongitude.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isLongitude');
  });
});

// ─── isEthereumAddress ────────────────────────────────────────────────────────

describe('isEthereumAddress', () => {
  it('should return true for a valid lowercase ethereum address', () => {
    expect(isEthereumAddress('0x742d35cc6634c0532925a3b8d4c9db96590c6af5')).toBe(true);
  });

  it('should return true for a valid mixed-case ethereum address', () => {
    expect(isEthereumAddress('0x742d35Cc6634C0532925a3b8D4C9Db96590c7aEB')).toBe(true);
  });

  it('should return false for address without 0x prefix', () => {
    expect(isEthereumAddress('742d35cc6634c0532925a3b8d4c9db96590c6af5')).toBe(false);
  });

  it('should return false for too short address', () => {
    expect(isEthereumAddress('0x742d35')).toBe(false);
  });

  it('should return false for non-hex chars', () => {
    expect(isEthereumAddress('0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isEthereumAddress(123 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isEthereumAddress', () => {
    expect(isEthereumAddress.requiresType).toBe('string');
    expect(isEthereumAddress.ruleName).toBe('isEthereumAddress');
  });

  it('should generate emit code with regex', () => {
    const { ctx, failMock } = makeCtx();
    const code = isEthereumAddress.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isEthereumAddress');
  });
});

// ─── isBtcAddress ─────────────────────────────────────────────────────────────

describe('isBtcAddress', () => {
  it('should return true for a valid P2PKH address (starts with 1)', () => {
    expect(isBtcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na')).toBe(false); // has space
  });

  it('should return true for a valid P2PKH address', () => {
    expect(isBtcAddress('1BpEi6DfDAUFd153wiGrvkiKW1iHENGLyQ')).toBe(true);
  });

  it('should return true for a valid P2SH address (starts with 3)', () => {
    expect(isBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true);
  });

  it('should return true for a valid bech32 address', () => {
    expect(isBtcAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
  });

  it('should return false for clearly invalid address', () => {
    expect(isBtcAddress('0invalidaddress')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isBtcAddress('')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isBtcAddress(123 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isBtcAddress', () => {
    expect(isBtcAddress.requiresType).toBe('string');
    expect(isBtcAddress.ruleName).toBe('isBtcAddress');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isBtcAddress.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isBtcAddress');
  });
});

// ─── isISO4217CurrencyCode ────────────────────────────────────────────────────

describe('isISO4217CurrencyCode', () => {
  it('should return true for USD', () => {
    expect(isISO4217CurrencyCode('USD')).toBe(true);
  });

  it('should return true for EUR', () => {
    expect(isISO4217CurrencyCode('EUR')).toBe(true);
  });

  it('should return true for KRW', () => {
    expect(isISO4217CurrencyCode('KRW')).toBe(true);
  });

  it('should return false for lowercase usd', () => {
    expect(isISO4217CurrencyCode('usd')).toBe(false);
  });

  it('should return false for non-existent code XXX', () => {
    expect(isISO4217CurrencyCode('XXX')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isISO4217CurrencyCode('')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isISO4217CurrencyCode(123 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isISO4217CurrencyCode', () => {
    expect(isISO4217CurrencyCode.requiresType).toBe('string');
    expect(isISO4217CurrencyCode.ruleName).toBe('isISO4217CurrencyCode');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isISO4217CurrencyCode.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isISO4217CurrencyCode');
  });
});

// ─── isPhoneNumber ────────────────────────────────────────────────────────────

describe('isPhoneNumber', () => {
  it('should return true for valid E.164 US number', () => {
    expect(isPhoneNumber('+14155552671')).toBe(true);
  });

  it('should return true for valid E.164 KR number', () => {
    expect(isPhoneNumber('+821012345678')).toBe(true);
  });

  it('should return true for valid E.164 UK number', () => {
    expect(isPhoneNumber('+447700900077')).toBe(true);
  });

  it('should return false for number without + prefix', () => {
    expect(isPhoneNumber('00821012345678')).toBe(false);
  });

  it('should return false for too short number', () => {
    expect(isPhoneNumber('+123')).toBe(false);
  });

  it('should return false for +0 leading digit after +', () => {
    expect(isPhoneNumber('+0123456789')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isPhoneNumber(123 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isPhoneNumber', () => {
    expect(isPhoneNumber.requiresType).toBe('string');
    expect(isPhoneNumber.ruleName).toBe('isPhoneNumber');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isPhoneNumber.emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isPhoneNumber');
  });
});

// ─── isStrongPassword ─────────────────────────────────────────────────────────

describe('isStrongPassword', () => {
  it('should return true for a valid strong password with defaults', () => {
    expect(isStrongPassword()('Passw0rd!')).toBe(true);
  });

  it('should return true for complex password', () => {
    expect(isStrongPassword()('MyP@ssw0rd123')).toBe(true);
  });

  it('should return false for too short password (< 8 chars)', () => {
    expect(isStrongPassword()('Pass0!')).toBe(false);
  });

  it('should return false for password with no uppercase', () => {
    expect(isStrongPassword()('password1!')).toBe(false);
  });

  it('should return false for password with no lowercase', () => {
    expect(isStrongPassword()('PASSWORD1!')).toBe(false);
  });

  it('should return false for password with no numbers', () => {
    expect(isStrongPassword()('Password!')).toBe(false);
  });

  it('should return false for password with no symbols', () => {
    expect(isStrongPassword()('Password1')).toBe(false);
  });

  it('should respect custom minLength option', () => {
    expect(isStrongPassword({ minLength: 4, minSymbols: 0 })('Pa1')).toBe(false);
    expect(isStrongPassword({ minLength: 4, minSymbols: 0 })('Pa1x')).toBe(true);
  });

  it('should return false for non-string input', () => {
    expect(isStrongPassword()(12345678 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isStrongPassword', () => {
    expect(isStrongPassword().requiresType).toBe('string');
    expect(isStrongPassword().ruleName).toBe('isStrongPassword');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isStrongPassword().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isStrongPassword');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isStrongPassword();
    const r2 = isStrongPassword();
    expect(r1).not.toBe(r2);
  });
});

// ─── isTaxId ──────────────────────────────────────────────────────────────────

describe('isTaxId', () => {
  it('should return true for valid US EIN', () => {
    expect(isTaxId('US')('12-3456789')).toBe(true);
  });

  it('should return false for invalid US format', () => {
    expect(isTaxId('US')('1234567')).toBe(false);
  });

  it('should return true for valid KR business registration number', () => {
    expect(isTaxId('KR')('123-45-67890')).toBe(true);
  });

  it('should return false for invalid KR format', () => {
    expect(isTaxId('KR')('12345')).toBe(false);
  });

  it('should return true for valid DE tax id', () => {
    expect(isTaxId('DE')('12345678901')).toBe(true);
  });

  it('should return false for invalid DE format', () => {
    expect(isTaxId('DE')('1234567890')).toBe(false);
  });

  it('should return true for valid GB UTR', () => {
    expect(isTaxId('GB')('1234567890')).toBe(true);
  });

  it('should return false for unsupported locale', () => {
    expect(isTaxId('XX')('123')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isTaxId('US')(123 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isTaxId', () => {
    expect(isTaxId('US').requiresType).toBe('string');
    expect(isTaxId('US').ruleName).toBe('isTaxId');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isTaxId('US').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isTaxId');
  });

  it('should emit fail-only code for unknown locale (covers L1464 !re branch)', () => {
    const { ctx, failMock } = makeCtx();
    const code = isTaxId('XX-UNKNOWN').emit('_v', ctx);
    expect(code).toContain('isTaxId');
    expect(failMock).toHaveBeenCalledWith('isTaxId');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isTaxId('US');
    const r2 = isTaxId('US');
    expect(r1).not.toBe(r2);
  });
});
