import type { ValidationOptions } from '../interfaces';

const noop: PropertyDecorator = () => {};

export function Min(_n: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function Max(_n: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsPositive(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsNegative(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsDivisibleBy(_n: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
