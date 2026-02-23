export interface ExposeOptions {
  name?: string;
  groups?: string[];
  since?: number;
  until?: number;
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

export interface ExcludeOptions {
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

export interface TransformOptions {
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
  groups?: string[];
}

export interface TypeOptions {
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

const noop: PropertyDecorator = () => {};

export function Expose(_options?: ExposeOptions): PropertyDecorator { return noop; }
export function Exclude(_options?: ExcludeOptions): PropertyDecorator { return noop; }
export function Transform(_fn: (value: unknown, obj: unknown) => unknown, _options?: TransformOptions): PropertyDecorator { return noop; }
export function Type(_fn: () => new (...args: any[]) => unknown, _options?: TypeOptions): PropertyDecorator { return noop; }
