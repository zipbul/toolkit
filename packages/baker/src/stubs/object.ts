import type { ValidationOptions } from '../interfaces';

export interface IsNotEmptyObjectOptions {
  nullable?: boolean;
}

const noop: PropertyDecorator = () => {};

export function IsNotEmptyObject(_objectOptions?: IsNotEmptyObjectOptions, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsInstance(_targetType: new (...args: any[]) => unknown, _options?: ValidationOptions): PropertyDecorator { return noop; }
