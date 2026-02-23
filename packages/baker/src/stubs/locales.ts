import type { ValidationOptions } from '../interfaces';

const noop: PropertyDecorator = () => {};

export function IsMobilePhone(_locale: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsPostalCode(_locale: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsIdentityCard(_locale: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsPassportNumber(_locale: string, _options?: ValidationOptions): PropertyDecorator { return noop; }
