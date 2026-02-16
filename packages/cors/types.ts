/**
 * Type for defining allowed origins.
 * - boolean: true (allow all), false (disable CORS)
 * - string: Exact origin match
 * - RegExp: Pattern match
 * - (string | RegExp)[]: List of allowed origins
 * - CustomOriginFn: Custom validation function
 */
export type CustomOriginFn = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;

export type OriginOptions = boolean | string | RegExp | (string | RegExp)[] | CustomOriginFn;
