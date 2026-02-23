import type { ValidationOptions } from '../interfaces';

const noop: PropertyDecorator = () => {};

export function MinDate(_date: Date, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function MaxDate(_date: Date, _options?: ValidationOptions): PropertyDecorator { return noop; }
