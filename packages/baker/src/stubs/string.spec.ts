import { describe, it, expect } from 'bun:test';
import * as stubs from './string';

// All 69 exported stub function names
const EXPECTED_EXPORTS = [
  'MinLength', 'MaxLength', 'Length', 'Contains', 'NotContains', 'Matches',
  'IsLowercase', 'IsUppercase', 'IsAscii', 'IsAlpha', 'IsAlphanumeric',
  'IsBooleanString', 'IsNumberString', 'IsDecimal', 'IsFullWidth', 'IsHalfWidth',
  'IsVariableWidth', 'IsMultibyte', 'IsSurrogatePair', 'IsHexadecimal', 'IsOctal',
  'IsEmail', 'IsURL', 'IsUUID', 'IsIP', 'IsHexColor', 'IsRgbColor', 'IsHSL',
  'IsMACAddress', 'IsISBN', 'IsISIN', 'IsISO8601', 'IsISRC', 'IsISSN', 'IsJWT',
  'IsLatLong', 'IsLocale', 'IsDataURI', 'IsFQDN', 'IsPort', 'IsEAN',
  'IsISO31661Alpha2', 'IsISO31661Alpha3', 'IsBIC', 'IsFirebasePushId', 'IsSemVer',
  'IsMongoId', 'IsJSON', 'IsBase32', 'IsBase58', 'IsBase64', 'IsDateString',
  'IsMimeType', 'IsCurrency', 'IsMagnetURI', 'IsCreditCard', 'IsIBAN',
  'IsByteLength', 'IsHash', 'IsRFC3339', 'IsMilitaryTime', 'IsLatitude',
  'IsLongitude', 'IsEthereumAddress', 'IsBtcAddress', 'IsISO4217CurrencyCode',
  'IsPhoneNumber', 'IsStrongPassword', 'IsTaxId',
] as const;

describe('stubs/string', () => {
  it('should export all 69 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    // Representative sample covering different arg shapes
    expect(typeof stubs.MinLength(1)).toBe('function');
    expect(typeof stubs.Length(1, 10)).toBe('function');
    expect(typeof stubs.Matches(/test/)).toBe('function');
    expect(typeof stubs.IsEmail()).toBe('function');
    expect(typeof stubs.IsURL()).toBe('function');
    expect(typeof stubs.IsUUID('4')).toBe('function');
    expect(typeof stubs.IsIP(4)).toBe('function');
    expect(typeof stubs.IsByteLength(0, 100)).toBe('function');
    expect(typeof stubs.IsHash('md5')).toBe('function');
    expect(typeof stubs.IsStrongPassword()).toBe('function');
  });

  it('should not throw when returned decorator is applied to a dummy target', () => {
    const target = {};
    const key = 'field';
    for (const name of EXPECTED_EXPORTS) {
      const decorator = (stubs as Record<string, (...args: any[]) => PropertyDecorator>)[name](undefined as any);
      expect(() => decorator(target, key)).not.toThrow();
    }
  });
});
