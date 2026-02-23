import type { ValidationOptions } from '../interfaces';
import type { IsNumberOptions } from '../rules/typechecker';

const noop: PropertyDecorator = () => {};

export function IsString(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsNumber(_numberOptions?: IsNumberOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsBoolean(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsDate(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsEnum(_entity: object, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsInt(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsArray(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsObject(_options?: ValidationOptions): PropertyDecorator { return noop; }
