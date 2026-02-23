import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import {
  MinLength, MaxLength, Length,
  Contains, NotContains, Matches,
  IsLowercase, IsUppercase, IsAscii, IsAlpha, IsAlphanumeric,
  IsFullWidth, IsHalfWidth, IsVariableWidth, IsMultibyte, IsSurrogatePair,
  IsEmail, IsURL, IsUUID, IsIP,
  IsHexColor, IsRgbColor, IsHSL, IsMACAddress,
  IsJSON, IsJWT, IsSemVer,
  IsBase64, IsBase32, IsBase58, IsMongoId, IsBooleanString, IsNumberString,
  IsDecimal, IsHexadecimal, IsOctal, IsDataURI, IsPort,
  IsISBN, IsISIN, IsISO8601, IsISRC, IsISSN, IsBIC, IsIBAN, IsIBANOptions,
  IsByteLength, IsHash,
  IsLatLong, IsLocale, IsFQDN, IsEAN,
  IsISO31661Alpha2, IsISO31661Alpha3, IsFirebasePushId,
  IsDateString, IsMimeType, IsCurrency, IsMagnetURI, IsCreditCard,
  IsRFC3339, IsMilitaryTime, IsLatitude, IsLongitude,
  IsEthereumAddress, IsBtcAddress, IsISO4217CurrencyCode, IsPhoneNumber,
  IsStrongPassword, IsTaxId,
} from './string';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsString {};
  createdCtors.push(ctor);
  return ctor as any;
}

function getRaw(ctor: Function, key: string): any {
  return (ctor as any)[RAW]?.[key];
}

function ruleAt(ctor: Function, key: string, idx = 0) {
  return getRaw(ctor, key)?.validation?.[idx]?.rule;
}

afterEach(() => {
  for (const ctor of createdCtors) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[RAW];
  }
  createdCtors.length = 0;
});

describe('string decorators — metadata collection', () => {
  // ── parameterized length ──────────────────────────────────────────────────

  it('@MinLength(3) registers ruleName', () => {
    const Cls = makeClass();
    MinLength(3)(Cls.prototype, 'name');
    expect(ruleAt(Cls, 'name')?.ruleName).toBe('minLength');
  });

  it('@MaxLength(10) registers ruleName', () => {
    const Cls = makeClass();
    MaxLength(10)(Cls.prototype, 'name');
    expect(ruleAt(Cls, 'name')?.ruleName).toBe('maxLength');
  });

  it('@Length(2, 8) registers ruleName', () => {
    const Cls = makeClass();
    Length(2, 8)(Cls.prototype, 'code');
    expect(ruleAt(Cls, 'code')?.ruleName).toBe('length');
  });

  it('@MinLength forwards options', () => {
    const Cls = makeClass();
    MinLength(1, { message: 'too short' })(Cls.prototype, 'f');
    expect(getRaw(Cls, 'f').validation[0].message).toBe('too short');
  });

  // ── contains / matches ────────────────────────────────────────────────────

  it('@Contains registers ruleName', () => {
    const Cls = makeClass();
    Contains('foo')(Cls.prototype, 'title');
    expect(ruleAt(Cls, 'title')?.ruleName).toBe('contains');
  });

  it('@NotContains registers ruleName', () => {
    const Cls = makeClass();
    NotContains('script')(Cls.prototype, 'body');
    expect(ruleAt(Cls, 'body')?.ruleName).toBe('notContains');
  });

  it('@Matches registers ruleName', () => {
    const Cls = makeClass();
    Matches(/^\d+$/, undefined)(Cls.prototype, 'zip');
    expect(ruleAt(Cls, 'zip')?.ruleName).toBe('matches');
  });

  // ── case / encoding ───────────────────────────────────────────────────────

  it('@IsLowercase registers ruleName', () => {
    const Cls = makeClass();
    IsLowercase()(Cls.prototype, 'slug');
    expect(ruleAt(Cls, 'slug')?.ruleName).toBe('isLowercase');
  });

  it('@IsUppercase registers ruleName', () => {
    const Cls = makeClass();
    IsUppercase()(Cls.prototype, 'code');
    expect(ruleAt(Cls, 'code')?.ruleName).toBe('isUppercase');
  });

  it('@IsAscii registers ruleName', () => {
    const Cls = makeClass();
    IsAscii()(Cls.prototype, 'f');
    expect(ruleAt(Cls, 'f')?.ruleName).toBe('isAscii');
  });

  it('@IsAlpha registers ruleName', () => {
    const Cls = makeClass();
    IsAlpha()(Cls.prototype, 'f');
    expect(ruleAt(Cls, 'f')?.ruleName).toBe('isAlpha');
  });

  it('@IsAlphanumeric registers ruleName', () => {
    const Cls = makeClass();
    IsAlphanumeric()(Cls.prototype, 'f');
    expect(ruleAt(Cls, 'f')?.ruleName).toBe('isAlphanumeric');
  });

  // ── internet ──────────────────────────────────────────────────────────────

  it('@IsEmail registers ruleName', () => {
    const Cls = makeClass();
    IsEmail()(Cls.prototype, 'email');
    expect(ruleAt(Cls, 'email')?.ruleName).toBe('isEmail');
  });

  it('@IsEmail forwards emailOptions + validationOptions', () => {
    const Cls = makeClass();
    IsEmail({ allow_display_name: true }, { message: 'bad email' })(Cls.prototype, 'email');
    expect(getRaw(Cls, 'email').validation[0].message).toBe('bad email');
  });

  it('@IsURL registers ruleName', () => {
    const Cls = makeClass();
    IsURL()(Cls.prototype, 'url');
    expect(ruleAt(Cls, 'url')?.ruleName).toBe('isURL');
  });

  it('@IsUUID registers ruleName', () => {
    const Cls = makeClass();
    IsUUID()(Cls.prototype, 'id');
    expect(ruleAt(Cls, 'id')?.ruleName).toBe('isUUID');
  });

  it('@IsUUID(4) registers with version', () => {
    const Cls = makeClass();
    IsUUID(4)(Cls.prototype, 'id');
    expect(ruleAt(Cls, 'id')?.ruleName).toBe('isUUID');
  });

  it('@IsIP registers ruleName', () => {
    const Cls = makeClass();
    IsIP()(Cls.prototype, 'ip');
    expect(ruleAt(Cls, 'ip')?.ruleName).toBe('isIP');
  });

  it('@IsIP(6) registers with version', () => {
    const Cls = makeClass();
    IsIP(6)(Cls.prototype, 'ip');
    expect(ruleAt(Cls, 'ip')?.ruleName).toBe('isIP');
  });

  // ── format identifiers ────────────────────────────────────────────────────

  it('@IsHexColor registers ruleName', () => {
    const Cls = makeClass();
    IsHexColor()(Cls.prototype, 'color');
    expect(ruleAt(Cls, 'color')?.ruleName).toBe('isHexColor');
  });

  it('@IsJSON registers ruleName', () => {
    const Cls = makeClass();
    IsJSON()(Cls.prototype, 'payload');
    expect(ruleAt(Cls, 'payload')?.ruleName).toBe('isJSON');
  });

  it('@IsJWT registers ruleName', () => {
    const Cls = makeClass();
    IsJWT()(Cls.prototype, 'token');
    expect(ruleAt(Cls, 'token')?.ruleName).toBe('isJWT');
  });

  it('@IsSemVer registers ruleName', () => {
    const Cls = makeClass();
    IsSemVer()(Cls.prototype, 'version');
    expect(ruleAt(Cls, 'version')?.ruleName).toBe('isSemVer');
  });

  it('@IsBase64 registers ruleName', () => {
    const Cls = makeClass();
    IsBase64()(Cls.prototype, 'img');
    expect(ruleAt(Cls, 'img')?.ruleName).toBe('isBase64');
  });

  it('@IsMongoId registers ruleName', () => {
    const Cls = makeClass();
    IsMongoId()(Cls.prototype, 'id');
    expect(ruleAt(Cls, 'id')?.ruleName).toBe('isMongoId');
  });

  // ── string formats (number / boolean representations) ─────────────────────

  it('@IsBooleanString registers ruleName', () => {
    const Cls = makeClass();
    IsBooleanString()(Cls.prototype, 'flag');
    expect(ruleAt(Cls, 'flag')?.ruleName).toBe('isBooleanString');
  });

  it('@IsNumberString registers ruleName', () => {
    const Cls = makeClass();
    IsNumberString()(Cls.prototype, 'num');
    expect(ruleAt(Cls, 'num')?.ruleName).toBe('isNumberString');
  });

  it('@IsDecimal registers ruleName', () => {
    const Cls = makeClass();
    IsDecimal()(Cls.prototype, 'price');
    expect(ruleAt(Cls, 'price')?.ruleName).toBe('isDecimal');
  });

  it('@IsHexadecimal registers ruleName', () => {
    const Cls = makeClass();
    IsHexadecimal()(Cls.prototype, 'hex');
    expect(ruleAt(Cls, 'hex')?.ruleName).toBe('isHexadecimal');
  });

  it('@IsOctal registers ruleName', () => {
    const Cls = makeClass();
    IsOctal()(Cls.prototype, 'oct');
    expect(ruleAt(Cls, 'oct')?.ruleName).toBe('isOctal');
  });

  // ── financial / standard ──────────────────────────────────────────────────

  it('@IsISBN registers ruleName', () => {
    const Cls = makeClass();
    IsISBN()(Cls.prototype, 'isbn');
    expect(ruleAt(Cls, 'isbn')?.ruleName).toBe('isISBN');
  });

  it('@IsISIN registers ruleName', () => {
    const Cls = makeClass();
    IsISIN()(Cls.prototype, 'isin');
    expect(ruleAt(Cls, 'isin')?.ruleName).toBe('isISIN');
  });

  it('@IsISSN registers ruleName', () => {
    const Cls = makeClass();
    IsISSN()(Cls.prototype, 'issn');
    expect(ruleAt(Cls, 'issn')?.ruleName).toBe('isISSN');
  });

  it('@IsBIC registers ruleName', () => {
    const Cls = makeClass();
    IsBIC()(Cls.prototype, 'bic');
    expect(ruleAt(Cls, 'bic')?.ruleName).toBe('isBIC');
  });

  it('@IsIBAN registers ruleName', () => {
    const Cls = makeClass();
    IsIBAN()(Cls.prototype, 'iban');
    expect(ruleAt(Cls, 'iban')?.ruleName).toBe('isIBAN');
  });

  // ── misc ──────────────────────────────────────────────────────────────────

  it('@IsDataURI registers ruleName', () => {
    const Cls = makeClass();
    IsDataURI()(Cls.prototype, 'img');
    expect(ruleAt(Cls, 'img')?.ruleName).toBe('isDataURI');
  });

  it('@IsPort registers ruleName', () => {
    const Cls = makeClass();
    IsPort()(Cls.prototype, 'port');
    expect(ruleAt(Cls, 'port')?.ruleName).toBe('isPort');
  });

  it('@IsByteLength registers ruleName', () => {
    const Cls = makeClass();
    IsByteLength(0, 255)(Cls.prototype, 'bio');
    expect(ruleAt(Cls, 'bio')?.ruleName).toBe('isByteLength');
  });

  it('@IsHash registers ruleName', () => {
    const Cls = makeClass();
    IsHash('sha256')(Cls.prototype, 'hash');
    expect(ruleAt(Cls, 'hash')?.ruleName).toBe('isHash');
  });

  // ── options forwarding ────────────────────────────────────────────────────

  it('@IsURL forwards validationOptions.message', () => {
    const Cls = makeClass();
    IsURL(undefined, { message: 'bad url' })(Cls.prototype, 'url');
    expect(getRaw(Cls, 'url').validation[0].message).toBe('bad url');
  });

  it('@IsUUID forwards validationOptions', () => {
    const Cls = makeClass();
    IsUUID(undefined, { groups: ['admin'] })(Cls.prototype, 'id');
    expect(getRaw(Cls, 'id').validation[0].groups).toEqual(['admin']);
  });

  // ── unicode / encoding ───────────────────────────────────────────────────

  it('@IsFullWidth registers ruleName', () => {
    const Cls = makeClass();
    IsFullWidth()(Cls.prototype, 'fw');
    expect(ruleAt(Cls, 'fw')?.ruleName).toBe('isFullWidth');
  });

  it('@IsHalfWidth registers ruleName', () => {
    const Cls = makeClass();
    IsHalfWidth()(Cls.prototype, 'hw');
    expect(ruleAt(Cls, 'hw')?.ruleName).toBe('isHalfWidth');
  });

  it('@IsVariableWidth registers ruleName', () => {
    const Cls = makeClass();
    IsVariableWidth()(Cls.prototype, 'vw');
    expect(ruleAt(Cls, 'vw')?.ruleName).toBe('isVariableWidth');
  });

  it('@IsMultibyte registers ruleName', () => {
    const Cls = makeClass();
    IsMultibyte()(Cls.prototype, 'mb');
    expect(ruleAt(Cls, 'mb')?.ruleName).toBe('isMultibyte');
  });

  it('@IsSurrogatePair registers ruleName', () => {
    const Cls = makeClass();
    IsSurrogatePair()(Cls.prototype, 'sp');
    expect(ruleAt(Cls, 'sp')?.ruleName).toBe('isSurrogatePair');
  });

  // ── color ────────────────────────────────────────────────────────────────

  it('@IsRgbColor registers ruleName', () => {
    const Cls = makeClass();
    IsRgbColor()(Cls.prototype, 'rgb');
    expect(ruleAt(Cls, 'rgb')?.ruleName).toBe('isRgbColor');
  });

  it('@IsHSL registers ruleName', () => {
    const Cls = makeClass();
    IsHSL()(Cls.prototype, 'hsl');
    expect(ruleAt(Cls, 'hsl')?.ruleName).toBe('isHSL');
  });

  // ── network / address ────────────────────────────────────────────────────

  it('@IsMACAddress registers ruleName', () => {
    const Cls = makeClass();
    IsMACAddress()(Cls.prototype, 'mac');
    expect(ruleAt(Cls, 'mac')?.ruleName).toBe('isMACAddress');
  });

  it('@IsLatLong registers ruleName', () => {
    const Cls = makeClass();
    IsLatLong()(Cls.prototype, 'loc');
    expect(ruleAt(Cls, 'loc')?.ruleName).toBe('isLatLong');
  });

  it('@IsLocale registers ruleName', () => {
    const Cls = makeClass();
    IsLocale()(Cls.prototype, 'locale');
    expect(ruleAt(Cls, 'locale')?.ruleName).toBe('isLocale');
  });

  it('@IsFQDN registers ruleName', () => {
    const Cls = makeClass();
    IsFQDN()(Cls.prototype, 'hostname');
    expect(ruleAt(Cls, 'hostname')?.ruleName).toBe('isFQDN');
  });

  it('@IsEAN registers ruleName', () => {
    const Cls = makeClass();
    IsEAN()(Cls.prototype, 'ean');
    expect(ruleAt(Cls, 'ean')?.ruleName).toBe('isEAN');
  });

  it('@IsLatitude registers ruleName', () => {
    const Cls = makeClass();
    IsLatitude()(Cls.prototype, 'lat');
    expect(ruleAt(Cls, 'lat')?.ruleName).toBe('isLatitude');
  });

  it('@IsLongitude registers ruleName', () => {
    const Cls = makeClass();
    IsLongitude()(Cls.prototype, 'lng');
    expect(ruleAt(Cls, 'lng')?.ruleName).toBe('isLongitude');
  });

  it('@IsEthereumAddress registers ruleName', () => {
    const Cls = makeClass();
    IsEthereumAddress()(Cls.prototype, 'eth');
    expect(ruleAt(Cls, 'eth')?.ruleName).toBe('isEthereumAddress');
  });

  it('@IsBtcAddress registers ruleName', () => {
    const Cls = makeClass();
    IsBtcAddress()(Cls.prototype, 'btc');
    expect(ruleAt(Cls, 'btc')?.ruleName).toBe('isBtcAddress');
  });

  it('@IsPhoneNumber registers ruleName', () => {
    const Cls = makeClass();
    IsPhoneNumber()(Cls.prototype, 'tel');
    expect(ruleAt(Cls, 'tel')?.ruleName).toBe('isPhoneNumber');
  });

  // ── ISO standards ────────────────────────────────────────────────────────

  it('@IsISO8601 registers ruleName', () => {
    const Cls = makeClass();
    IsISO8601()(Cls.prototype, 'dt');
    expect(ruleAt(Cls, 'dt')?.ruleName).toBe('isISO8601');
  });

  it('@IsISRC registers ruleName', () => {
    const Cls = makeClass();
    IsISRC()(Cls.prototype, 'isrc');
    expect(ruleAt(Cls, 'isrc')?.ruleName).toBe('isISRC');
  });

  it('@IsISO31661Alpha2 registers ruleName', () => {
    const Cls = makeClass();
    IsISO31661Alpha2()(Cls.prototype, 'country');
    expect(ruleAt(Cls, 'country')?.ruleName).toBe('isISO31661Alpha2');
  });

  it('@IsISO31661Alpha3 registers ruleName', () => {
    const Cls = makeClass();
    IsISO31661Alpha3()(Cls.prototype, 'country3');
    expect(ruleAt(Cls, 'country3')?.ruleName).toBe('isISO31661Alpha3');
  });

  it('@IsISO4217CurrencyCode registers ruleName', () => {
    const Cls = makeClass();
    IsISO4217CurrencyCode()(Cls.prototype, 'currency');
    expect(ruleAt(Cls, 'currency')?.ruleName).toBe('isISO4217CurrencyCode');
  });

  // ── media / data ─────────────────────────────────────────────────────────

  it('@IsBase32 registers ruleName', () => {
    const Cls = makeClass();
    IsBase32()(Cls.prototype, 'b32');
    expect(ruleAt(Cls, 'b32')?.ruleName).toBe('isBase32');
  });

  it('@IsBase58 registers ruleName', () => {
    const Cls = makeClass();
    IsBase58()(Cls.prototype, 'b58');
    expect(ruleAt(Cls, 'b58')?.ruleName).toBe('isBase58');
  });

  it('@IsDateString registers ruleName', () => {
    const Cls = makeClass();
    IsDateString()(Cls.prototype, 'ds');
    expect(ruleAt(Cls, 'ds')?.ruleName).toBe('isDateString');
  });

  it('@IsMimeType registers ruleName', () => {
    const Cls = makeClass();
    IsMimeType()(Cls.prototype, 'mime');
    expect(ruleAt(Cls, 'mime')?.ruleName).toBe('isMimeType');
  });

  it('@IsCurrency registers ruleName', () => {
    const Cls = makeClass();
    IsCurrency()(Cls.prototype, 'price');
    expect(ruleAt(Cls, 'price')?.ruleName).toBe('isCurrency');
  });

  it('@IsMagnetURI registers ruleName', () => {
    const Cls = makeClass();
    IsMagnetURI()(Cls.prototype, 'magnet');
    expect(ruleAt(Cls, 'magnet')?.ruleName).toBe('isMagnetURI');
  });

  it('@IsCreditCard registers ruleName', () => {
    const Cls = makeClass();
    IsCreditCard()(Cls.prototype, 'cc');
    expect(ruleAt(Cls, 'cc')?.ruleName).toBe('isCreditCard');
  });

  it('@IsFirebasePushId registers ruleName', () => {
    const Cls = makeClass();
    IsFirebasePushId()(Cls.prototype, 'fbid');
    expect(ruleAt(Cls, 'fbid')?.ruleName).toBe('isFirebasePushId');
  });

  // ── time / finance ───────────────────────────────────────────────────────

  it('@IsRFC3339 registers ruleName', () => {
    const Cls = makeClass();
    IsRFC3339()(Cls.prototype, 'ts');
    expect(ruleAt(Cls, 'ts')?.ruleName).toBe('isRFC3339');
  });

  it('@IsMilitaryTime registers ruleName', () => {
    const Cls = makeClass();
    IsMilitaryTime()(Cls.prototype, 'time');
    expect(ruleAt(Cls, 'time')?.ruleName).toBe('isMilitaryTime');
  });

  it('@IsStrongPassword registers ruleName', () => {
    const Cls = makeClass();
    IsStrongPassword()(Cls.prototype, 'pw');
    expect(ruleAt(Cls, 'pw')?.ruleName).toBe('isStrongPassword');
  });

  it('@IsTaxId registers ruleName', () => {
    const Cls = makeClass();
    IsTaxId('en-US')(Cls.prototype, 'tax');
    expect(ruleAt(Cls, 'tax')?.ruleName).toBe('isTaxId');
  });
});
