import type { ValidationOptions } from '../interfaces';
import type {
  IsEmailOptions, IsURLOptions, IsBase32Options, IsBase64Options,
  IsDateStringOptions, IsCurrencyOptions, IsMACAddressOptions,
  IsIBANOptions, IsISSNOptions, IsFQDNOptions, IsLatLongOptions,
  IsISO8601Options, IsNumberStringOptions, IsDecimalOptions,
  IsStrongPasswordOptions,
} from '../rules/string';

// Re-export option types
export type {
  IsEmailOptions, IsURLOptions, IsBase32Options, IsBase64Options,
  IsDateStringOptions, IsCurrencyOptions, IsMACAddressOptions,
  IsIBANOptions, IsISSNOptions, IsFQDNOptions, IsLatLongOptions,
  IsISO8601Options, IsNumberStringOptions, IsDecimalOptions,
  IsStrongPasswordOptions,
};

const noop: PropertyDecorator = () => {};

export function MinLength(_min: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function MaxLength(_max: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function Length(_min: number, _max: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function Contains(_seed: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function NotContains(_seed: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function Matches(_pattern: string | RegExp, _modifiers?: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsLowercase(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsUppercase(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsAscii(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsAlpha(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsAlphanumeric(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBooleanString(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsNumberString(_numberOptions?: IsNumberStringOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsDecimal(_decimalOptions?: IsDecimalOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsFullWidth(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsHalfWidth(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsVariableWidth(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMultibyte(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsSurrogatePair(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsHexadecimal(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsOctal(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsEmail(_emailOptions?: IsEmailOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsURL(_urlOptions?: IsURLOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsUUID(_version?: 1 | 2 | 3 | 4 | 5 | 'all', _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsIP(_version?: 4 | 6, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsHexColor(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsRgbColor(_includePercentValues?: boolean, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsHSL(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMACAddress(_macOptions?: IsMACAddressOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISBN(_version?: 10 | 13, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISIN(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISO8601(_isoOptions?: IsISO8601Options, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISRC(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISSN(_issnOptions?: IsISSNOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsJWT(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsLatLong(_latLongOptions?: IsLatLongOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsLocale(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsDataURI(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsFQDN(_fqdnOptions?: IsFQDNOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsPort(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsEAN(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISO31661Alpha2(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISO31661Alpha3(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBIC(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsFirebasePushId(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsSemVer(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMongoId(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsJSON(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBase32(_base32Options?: IsBase32Options, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBase58(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBase64(_base64Options?: IsBase64Options, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsDateString(_dateOptions?: IsDateStringOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMimeType(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsCurrency(_currencyOptions?: IsCurrencyOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMagnetURI(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsCreditCard(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsIBAN(_ibanOptions?: IsIBANOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsByteLength(_min: number, _max?: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsHash(_algorithm: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsRFC3339(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsMilitaryTime(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsLatitude(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsLongitude(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsEthereumAddress(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBtcAddress(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsISO4217CurrencyCode(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsPhoneNumber(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsStrongPassword(_pwOptions?: IsStrongPasswordOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsTaxId(_locale: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
