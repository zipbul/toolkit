import { collectValidation } from '../collect';
import {
  minLength, maxLength, length, contains, notContains, matches,
  isLowercase, isUppercase, isAscii, isAlpha, isAlphanumeric,
  isBooleanString, isNumberString, isDecimal, isFullWidth, isHalfWidth,
  isVariableWidth, isMultibyte, isSurrogatePair, isHexadecimal, isOctal,
  isEmail, isURL, isUUID, isIP, isHexColor, isRgbColor, isHSL, isMACAddress,
  isISBN, isISIN, isISO8601, isISRC, isISSN, isJWT, isLatLong, isLocale,
  isDataURI, isFQDN, isPort, isEAN, isISO31661Alpha2, isISO31661Alpha3,
  isBIC, isFirebasePushId, isSemVer, isMongoId, isJSON,
  isBase32, isBase58, isBase64, isDateString, isMimeType, isCurrency, isMagnetURI,
  isCreditCard, isIBAN, isByteLength,
  isHash, isRFC3339, isMilitaryTime, isLatitude, isLongitude,
  isEthereumAddress, isBtcAddress, isISO4217CurrencyCode, isPhoneNumber,
  isStrongPassword, isTaxId,
} from '../rules/string';
import type {
  IsEmailOptions, IsURLOptions, IsBase32Options, IsBase64Options,
  IsDateStringOptions, IsCurrencyOptions, IsMACAddressOptions,
  IsIBANOptions, IsISSNOptions, IsFQDNOptions, IsLatLongOptions,
  IsISO8601Options, IsNumberStringOptions, IsDecimalOptions,
  IsStrongPasswordOptions,
} from '../rules/string';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export option types for decorator consumer convenience
// ─────────────────────────────────────────────────────────────────────────────

export type {
  IsEmailOptions, IsURLOptions, IsBase32Options, IsBase64Options,
  IsDateStringOptions, IsCurrencyOptions, IsMACAddressOptions,
  IsIBANOptions, IsISSNOptions, IsFQDNOptions, IsLatLongOptions,
  IsISO8601Options, IsNumberStringOptions, IsDecimalOptions,
  IsStrongPasswordOptions,
};

// ─────────────────────────────────────────────────────────────────────────────
// Group A: Length / Range
// ─────────────────────────────────────────────────────────────────────────────

export function MinLength(min: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: minLength(min),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function MaxLength(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: maxLength(max),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function Length(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: length(min, max),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function Contains(seed: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: contains(seed),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function NotContains(seed: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: notContains(seed),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function Matches(pattern: string | RegExp, modifiers?: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: matches(pattern, modifiers),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B: Simple Boolean Checks
// ─────────────────────────────────────────────────────────────────────────────

export function IsLowercase(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isLowercase, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsUppercase(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isUppercase, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsAscii(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isAscii, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsAlpha(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isAlpha, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsAlphanumeric(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isAlphanumeric, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsBooleanString(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isBooleanString, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsNumberString(numberOptions?: IsNumberStringOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isNumberString(numberOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsDecimal(decimalOptions?: IsDecimalOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isDecimal(decimalOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsFullWidth(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isFullWidth, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsHalfWidth(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isHalfWidth, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsVariableWidth(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isVariableWidth, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsMultibyte(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isMultibyte, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsSurrogatePair(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isSurrogatePair, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsHexadecimal(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isHexadecimal, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsOctal(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isOctal, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group C: Internet / Format (options 있는 것들)
// ─────────────────────────────────────────────────────────────────────────────

export function IsEmail(emailOptions?: IsEmailOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isEmail(emailOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsURL(urlOptions?: IsURLOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isURL(urlOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsUUID(version?: 1 | 2 | 3 | 4 | 5 | 'all', options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isUUID(version),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsIP(version?: 4 | 6, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isIP(version),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsHexColor(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isHexColor, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsRgbColor(includePercentValues?: boolean, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isRgbColor(includePercentValues ?? false), each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsHSL(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isHSL, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsMACAddress(macOptions?: IsMACAddressOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isMACAddress(macOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsISBN(version?: 10 | 13, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isISBN(version),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsISIN(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isISIN, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsISO8601(isoOptions?: IsISO8601Options, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isISO8601(isoOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsISRC(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isISRC, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsISSN(issnOptions?: IsISSNOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isISSN(issnOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsJWT(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isJWT, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsLatLong(latLongOptions?: IsLatLongOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isLatLong(latLongOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsLocale(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isLocale, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsDataURI(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isDataURI, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsFQDN(fqdnOptions?: IsFQDNOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isFQDN(fqdnOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsPort(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isPort, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsEAN(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isEAN, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsISO31661Alpha2(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isISO31661Alpha2, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsISO31661Alpha3(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isISO31661Alpha3, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsBIC(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isBIC, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsFirebasePushId(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isFirebasePushId, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsSemVer(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isSemVer, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsMongoId(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isMongoId, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsJSON(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isJSON, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsBase32(base32Options?: IsBase32Options, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isBase32(base32Options),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsBase58(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isBase58, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsBase64(base64Options?: IsBase64Options, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isBase64(base64Options),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsDateString(dateOptions?: IsDateStringOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isDateString(dateOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsMimeType(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isMimeType, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsCurrency(currencyOptions?: IsCurrencyOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isCurrency(currencyOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsMagnetURI(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isMagnetURI, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsCreditCard(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isCreditCard, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsIBAN(ibanOptions?: IsIBANOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isIBAN(ibanOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsByteLength(min: number, max?: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isByteLength(min, max),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group E: New Validators
// ─────────────────────────────────────────────────────────────────────────────

export function IsHash(algorithm: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isHash(algorithm),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsRFC3339(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isRFC3339, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsMilitaryTime(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isMilitaryTime, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsLatitude(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isLatitude, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsLongitude(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isLongitude, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsEthereumAddress(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isEthereumAddress, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsBtcAddress(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isBtcAddress, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsISO4217CurrencyCode(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isISO4217CurrencyCode, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsPhoneNumber(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, { rule: isPhoneNumber, each: options?.each, groups: options?.groups, message: options?.message, context: options?.context });
  };
}

export function IsStrongPassword(pwOptions?: IsStrongPasswordOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isStrongPassword(pwOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

export function IsTaxId(locale: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isTaxId(locale),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
