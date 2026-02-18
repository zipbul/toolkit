import { HttpHeader, HttpStatus } from '@zipbul/shared';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import type { CorsOptions, CorsResult } from './interfaces';
import type { OriginOptions, OriginResult } from './types';

export class CorsHandler {
  constructor(private readonly options: CorsOptions = {}) {}

  public async handle(request: Request): Promise<CorsResult> {
    const origin = request.headers.get(HttpHeader.Origin);

    if (origin === null || origin.length === 0) {
      return this.createDisallowedResult();
    }

    const allowedOrigin = await this.matchOrigin(origin, request);

    if (allowedOrigin === undefined) {
      return this.createDisallowedResult();
    }

    const headers = new Headers();

    headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin);

    if (allowedOrigin !== '*') {
      headers.append(HttpHeader.Vary, HttpHeader.Origin);
    }

    if (this.options.credentials === true) {
      headers.set(HttpHeader.AccessControlAllowCredentials, 'true');
    }

    if (request.method !== 'OPTIONS') {
      if (this.options.exposedHeaders !== undefined && this.options.exposedHeaders.length > 0) {
        const exposeHeadersValue = this.serializeExposeHeaders(this.options.exposedHeaders);

        if (exposeHeadersValue !== undefined) {
          headers.set(HttpHeader.AccessControlExposeHeaders, exposeHeadersValue);
        }
      }

      return {
        headers,
        isPreflight: false,
        isAllowed: true,
        shouldRespond: false,
        statusCode: null,
      };
    }

    const requestMethod = request.headers.get(HttpHeader.AccessControlRequestMethod);

    if (requestMethod === null || requestMethod.length === 0) {
      return {
        headers,
        isPreflight: false,
        isAllowed: true,
        shouldRespond: false,
        statusCode: null,
      };
    }

    const allowedMethods = this.options.methods ?? CORS_DEFAULT_METHODS;

    if (!this.isMethodAllowed(requestMethod, allowedMethods)) {
      return this.createDisallowedResult(true);
    }

    const allowMethodsValue = this.serializeAllowedMethods(allowedMethods, requestMethod);

    headers.set(HttpHeader.AccessControlAllowMethods, allowMethodsValue);

    headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestMethod);

    const requestHeadersRaw = request.headers.get(HttpHeader.AccessControlRequestHeaders);
    const requestHeaders = this.parseCommaSeparatedValues(requestHeadersRaw);

    if (this.options.allowedHeaders !== undefined) {
      if (!this.areRequestHeadersAllowed(requestHeaders, this.options.allowedHeaders)) {
        return this.createDisallowedResult(true);
      }

      const allowHeadersValue = this.serializeAllowedHeaders(this.options.allowedHeaders, requestHeadersRaw);

      if (allowHeadersValue !== undefined) {
        headers.set(HttpHeader.AccessControlAllowHeaders, allowHeadersValue);
        headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);
      }
    } else {
      if (requestHeadersRaw !== null && requestHeadersRaw.length > 0) {
        headers.set(HttpHeader.AccessControlAllowHeaders, requestHeadersRaw);
        headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);
      }
    }

    if (this.options.maxAge !== undefined) {
      headers.set(HttpHeader.AccessControlMaxAge, this.options.maxAge.toString());
    }

    const preflightContinue = this.options.preflightContinue ?? false;

    if (preflightContinue) {
      return {
        headers,
        isPreflight: true,
        isAllowed: true,
        shouldRespond: false,
        statusCode: null,
      };
    }

    const statusCode = this.options.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS;

    return {
      headers,
      isPreflight: true,
      isAllowed: true,
      shouldRespond: true,
      statusCode,
    };
  }

  public static applyHeaders(result: CorsResult, response: Response): Response {
    const mergedHeaders = new Headers(response.headers);

    for (const [name, value] of result.headers.entries()) {
      if (name.toLowerCase() === HttpHeader.Vary.toLowerCase()) {
        const mergedVary = CorsHandler.mergeVaryValues(mergedHeaders.get(HttpHeader.Vary), value);

        mergedHeaders.set(HttpHeader.Vary, mergedVary);
        continue;
      }

      mergedHeaders.set(name, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders,
    });
  }

  public static createPreflightResponse(result: CorsResult): Response {
    const status = result.statusCode ?? HttpStatus.NoContent;

    return new Response(null, {
      status,
      headers: result.headers,
    });
  }

  private createDisallowedResult(isPreflight = false): CorsResult {
    return {
      headers: new Headers(),
      isPreflight,
      isAllowed: false,
      shouldRespond: false,
      statusCode: null,
    };
  }

  private async matchOrigin(origin: string, request: Request): Promise<string | undefined> {
    const originOption: OriginOptions | undefined = this.options.origin;

    if (originOption === false) {
      return undefined;
    }

    if (originOption === undefined || originOption === '*') {
      return this.options.credentials === true ? origin : '*';
    }

    if (typeof originOption === 'string') {
      return originOption === origin ? originOption : undefined;
    }

    if (typeof originOption === 'boolean') {
      return originOption ? origin : undefined;
    }

    if (originOption instanceof RegExp) {
      return originOption.test(origin) ? origin : undefined;
    }

    if (Array.isArray(originOption)) {
      const matched = originOption.some(entry => {
        if (entry instanceof RegExp) {
          return entry.test(origin);
        }

        return entry === origin;
      });

      return matched ? origin : undefined;
    }

    const originResult = await originOption(origin, request);

    return this.resolveOriginResult(origin, originResult);
  }

  private resolveOriginResult(origin: string, result: OriginResult): string | undefined {
    if (result === true) {
      return origin;
    }

    if (typeof result === 'string' && result.length > 0) {
      return result;
    }

    return undefined;
  }

  private static mergeVaryValues(existing: string | null, incoming: string): string {
    const values = new Map<string, string>();

    const append = (input: string | null): void => {
      if (input === null || input.length === 0) {
        return;
      }

      for (const item of input.split(',')) {
        const trimmed = item.trim();

        if (trimmed.length > 0) {
          const normalized = trimmed.toLowerCase();

          if (!values.has(normalized)) {
            values.set(normalized, trimmed);
          }
        }
      }
    };

    append(existing);
    append(incoming);

    return Array.from(values.values()).join(', ');
  }

  private serializeExposeHeaders(exposedHeaders: string[]): string | undefined {
    if (this.includesWildcard(exposedHeaders) && this.options.credentials === true) {
      return undefined;
    }

    return exposedHeaders.join(',');
  }

  private isMethodAllowed(requestMethod: string, allowedMethods: Array<string>): boolean {
    if (this.includesWildcard(allowedMethods)) {
      return true;
    }

    return allowedMethods.some(method => method.toLowerCase() === requestMethod.toLowerCase());
  }

  private serializeAllowedMethods(allowedMethods: Array<string>, requestMethod: string): string {
    if (!this.includesWildcard(allowedMethods)) {
      return allowedMethods.join(',');
    }

    if (this.options.credentials === true) {
      return requestMethod;
    }

    return '*';
  }

  private areRequestHeadersAllowed(requestHeaders: string[], allowedHeaders: string[]): boolean {
    if (requestHeaders.length === 0) {
      return true;
    }

    if (allowedHeaders.length === 0) {
      return false;
    }

    const hasWildcard = this.includesWildcard(allowedHeaders);

    if (hasWildcard) {
      const explicitHeaders = allowedHeaders.filter(header => header.trim() !== '*');

      const hasAuthorization = requestHeaders.some(header => header.toLowerCase() === 'authorization');

      if (hasAuthorization && !this.includesHeader(explicitHeaders, 'authorization')) {
        return false;
      }

      if (this.options.credentials !== true) {
        return true;
      }

      return requestHeaders.every(header => {
        if (this.includesHeader(explicitHeaders, header)) {
          return true;
        }

        return header.toLowerCase() !== 'authorization';
      });
    }

    return requestHeaders.every(header => this.includesHeader(allowedHeaders, header));
  }

  private serializeAllowedHeaders(allowedHeaders: string[], requestHeadersRaw: string | null): string | undefined {
    if (allowedHeaders.length === 0) {
      return undefined;
    }

    if (!this.includesWildcard(allowedHeaders)) {
      return allowedHeaders.join(',');
    }

    if (this.options.credentials === true) {
      if (requestHeadersRaw !== null && requestHeadersRaw.length > 0) {
        return requestHeadersRaw;
      }

      return undefined;
    }

    return '*';
  }

  private includesWildcard(values: string[]): boolean {
    return values.some(value => value.trim() === '*');
  }

  private includesHeader(allowedHeaders: string[], requestHeader: string): boolean {
    return allowedHeaders.some(header => header.toLowerCase() === requestHeader.toLowerCase());
  }

  private parseCommaSeparatedValues(value: string | null): string[] {
    if (value === null || value.length === 0) {
      return [];
    }

    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }
}
