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

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isISIN', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isISIN.emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
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

  it('should call ctx.addRegex and generate test code when calling emit() and have ruleName isISSN', () => {
    const { ctx, addRegexMock, failMock } = makeCtx(0);
    const code = isISSN().emit('_v', ctx);
    expect(addRegexMock).toHaveBeenCalled();
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

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isByteLength(1, 10);
    const r2 = isByteLength(1, 10);
    expect(r1).not.toBe(r2);
  });
});
