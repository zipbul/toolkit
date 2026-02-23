import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import {
  isMobilePhone,
  isPostalCode,
  isIdentityCard,
  isPassportNumber,
} from './locales';

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

// ─── isMobilePhone ────────────────────────────────────────────────────────────

describe('isMobilePhone', () => {
  it('should return true for valid ko-KR mobile (with country code)', () => {
    expect(isMobilePhone('ko-KR')('+821012345678')).toBe(true);
  });

  it('should return true for valid ko-KR mobile (without country code)', () => {
    expect(isMobilePhone('ko-KR')('01012345678')).toBe(true);
  });

  it('should return false for en-US number with ko-KR locale', () => {
    expect(isMobilePhone('ko-KR')('+14155552671')).toBe(false);
  });

  it('should return true for valid en-US mobile', () => {
    expect(isMobilePhone('en-US')('+14155552671')).toBe(true);
  });

  it('should return true for valid zh-CN mobile', () => {
    expect(isMobilePhone('zh-CN')('+8613812345678')).toBe(true);
  });

  it('should return true for valid ja-JP mobile', () => {
    expect(isMobilePhone('ja-JP')('+819012345678')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(isMobilePhone('ko-KR')('')).toBe(false);
  });

  it('should return false for plain text', () => {
    expect(isMobilePhone('ko-KR')('not-a-phone')).toBe(false);
  });

  it('should return false for unsupported locale', () => {
    expect(isMobilePhone('xx-XX')('+14155552671')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isMobilePhone('ko-KR')(12345 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isMobilePhone', () => {
    expect(isMobilePhone('ko-KR').requiresType).toBe('string');
    expect(isMobilePhone('ko-KR').ruleName).toBe('isMobilePhone');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isMobilePhone('ko-KR').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isMobilePhone');
  });

  it('should generate immediate fail code for unknown locale emit', () => {
    const { ctx, failMock } = makeCtx();
    const code = isMobilePhone('xx-XX' as any).emit('_v', ctx);
    expect(code).toContain('isMobilePhone');
    expect(failMock).toHaveBeenCalledWith('isMobilePhone');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    const r1 = isMobilePhone('ko-KR');
    const r2 = isMobilePhone('ko-KR');
    expect(r1).not.toBe(r2);
  });
});

// ─── isPostalCode ─────────────────────────────────────────────────────────────

describe('isPostalCode', () => {
  it('should return true for valid KR postal code (5 digits)', () => {
    expect(isPostalCode('KR')('12345')).toBe(true);
  });

  it('should return false for KR postal code with wrong length', () => {
    expect(isPostalCode('KR')('1234')).toBe(false);
  });

  it('should return true for valid US postal code (5 digits)', () => {
    expect(isPostalCode('US')('12345')).toBe(true);
  });

  it('should return true for valid US ZIP+4 code', () => {
    expect(isPostalCode('US')('12345-6789')).toBe(true);
  });

  it('should return false for invalid US postal code', () => {
    expect(isPostalCode('US')('1234')).toBe(false);
  });

  it('should return true for valid DE postal code (5 digits)', () => {
    expect(isPostalCode('DE')('12345')).toBe(true);
  });

  it('should return true for valid JP postal code', () => {
    expect(isPostalCode('JP')('123-4567')).toBe(true);
  });

  it('should return false for unsupported locale', () => {
    expect(isPostalCode('XX')('12345')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isPostalCode('KR')(12345 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isPostalCode', () => {
    expect(isPostalCode('KR').requiresType).toBe('string');
    expect(isPostalCode('KR').ruleName).toBe('isPostalCode');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isPostalCode('KR').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isPostalCode');
  });

  it('should generate immediate fail code for unknown locale emit', () => {
    const { ctx, failMock } = makeCtx();
    const code = isPostalCode('XX' as any).emit('_v', ctx);
    expect(code).toContain('isPostalCode');
    expect(failMock).toHaveBeenCalledWith('isPostalCode');
  });

  it('should return independent rule objects', () => {
    const r1 = isPostalCode('KR');
    const r2 = isPostalCode('KR');
    expect(r1).not.toBe(r2);
  });
});

// ─── isIdentityCard ───────────────────────────────────────────────────────────

describe('isIdentityCard', () => {
  it('should return true for a valid KR identity card (주민등록번호)', () => {
    // Valid format: XXXXXX-XXXXXXX where last digit is checksum
    // 900101-1234561 — digit validation only (regex pattern)
    expect(isIdentityCard('KR')('900101-1234567')).toBe(true);
  });

  it('should return false for invalid KR format (wrong separator)', () => {
    expect(isIdentityCard('KR')('9001011234567')).toBe(false);
  });

  it('should return true for valid CN identity card (18 digits)', () => {
    expect(isIdentityCard('CN')('110101199001011234')).toBe(true);
  });

  it('should return false for invalid CN identity card', () => {
    expect(isIdentityCard('CN')('1101011990010')).toBe(false);
  });

  it('should return true for valid US SSN', () => {
    expect(isIdentityCard('US')('123-45-6789')).toBe(true);
  });

  it('should return false for invalid US SSN', () => {
    expect(isIdentityCard('US')('12-345-6789')).toBe(false);
  });

  it('should return false for unsupported locale', () => {
    expect(isIdentityCard('XX')('123456789')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isIdentityCard('KR')(12345 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isIdentityCard', () => {
    expect(isIdentityCard('KR').requiresType).toBe('string');
    expect(isIdentityCard('KR').ruleName).toBe('isIdentityCard');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isIdentityCard('KR').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isIdentityCard');
  });

  it('should generate immediate fail code for unknown locale emit', () => {
    const { ctx, failMock } = makeCtx();
    const code = isIdentityCard('XX' as any).emit('_v', ctx);
    expect(code).toContain('isIdentityCard');
    expect(failMock).toHaveBeenCalledWith('isIdentityCard');
  });
});

// ─── isPassportNumber ─────────────────────────────────────────────────────────

describe('isPassportNumber', () => {
  it('should return true for valid KR passport (M12345678)', () => {
    expect(isPassportNumber('KR')('M12345678')).toBe(true);
  });

  it('should return false for KR passport with wrong format', () => {
    expect(isPassportNumber('KR')('A1234567')).toBe(false); // 7 digits — too short
  });

  it('should return true for valid US passport (9 digits)', () => {
    expect(isPassportNumber('US')('123456789')).toBe(true);
  });

  it('should return false for US passport with wrong length', () => {
    expect(isPassportNumber('US')('12345678')).toBe(false); // 8 digits
  });

  it('should return true for valid DE passport', () => {
    // DE: letter + 7 digits + letter
    expect(isPassportNumber('DE')('C01X00T47')).toBe(true);
  });

  it('should return false for unsupported locale', () => {
    expect(isPassportNumber('XX')('A12345678')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isPassportNumber('KR')(123456789 as any)).toBe(false);
  });

  it('should have requiresType string and ruleName isPassportNumber', () => {
    expect(isPassportNumber('KR').requiresType).toBe('string');
    expect(isPassportNumber('KR').ruleName).toBe('isPassportNumber');
  });

  it('should generate emit code', () => {
    const { ctx, failMock } = makeCtx();
    const code = isPassportNumber('KR').emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isPassportNumber');
  });

  it('should generate immediate fail code for unknown locale emit', () => {
    const { ctx, failMock } = makeCtx();
    const code = isPassportNumber('XX' as any).emit('_v', ctx);
    expect(code).toContain('isPassportNumber');
    expect(failMock).toHaveBeenCalledWith('isPassportNumber');
  });

  it('should return independent rule objects', () => {
    const r1 = isPassportNumber('KR');
    const r2 = isPassportNumber('KR');
    expect(r1).not.toBe(r2);
  });
});
