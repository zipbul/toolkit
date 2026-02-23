import type { ValidationOptions } from '../interfaces';

const noop: PropertyDecorator = () => {};

export function ArrayContains(_values: unknown[], _options?: ValidationOptions): PropertyDecorator { return noop; }
export function ArrayNotContains(_values: unknown[], _options?: ValidationOptions): PropertyDecorator { return noop; }
export function ArrayMinSize(_min: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function ArrayMaxSize(_max: number, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function ArrayUnique(_identifier?: (o: unknown) => unknown, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function ArrayNotEmpty(_options?: ValidationOptions): PropertyDecorator { return noop; }
