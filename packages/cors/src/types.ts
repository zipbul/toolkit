export type OriginResult = boolean | string;

export type OriginFn = (origin: string, request: Request) => OriginResult | Promise<OriginResult>;

export type OriginOptions = boolean | string | RegExp | Array<string | RegExp> | OriginFn;
