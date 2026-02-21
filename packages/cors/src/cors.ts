import { HttpHeader, HttpMethod } from '@zipbul/shared';
import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import type { CorsError, CorsOptions, CorsPreflightResult, CorsRejectResult } from './interfaces';
import { resolveCorsOptions, validateCorsOptions } from './options';
import type { CorsResult, ResolvedCorsOptions } from './types';
import type { OriginResult } from './types';

/**
 * Framework-agnostic CORS handler.
 * Evaluates CORS policy and returns a discriminated union result
 * instead of generating responses directly.
 */
export class Cors {
  private constructor(private readonly options: ResolvedCorsOptions) {}

  /**
   * Creates a Cors instance after resolving and validating options.
   *
   * @returns Cors instance on success, Err<CorsError> on validation failure.
   */
  public static create(options?: CorsOptions): Result<Cors, CorsError> {
    const resolved = resolveCorsOptions(options);
    const validationResult = validateCorsOptions(resolved);

    if (isErr(validationResult)) {
      return validationResult;
    }

    return new Cors(resolved);
  }

  /**
   * Evaluates CORS policy for the given request.
   *
   * @returns `Continue` — attach headers and proceed,
   *          `RespondPreflight` — return preflight response,
   *          `Reject` — deny with reason,
   *          `Err<CorsError>` — origin function threw.
   */
  public async handle(request: Request): Promise<Result<CorsResult, CorsError>> {
    const origin = request.headers.get(HttpHeader.Origin);

    if (origin === null || origin.length === 0) {
      return this.reject(CorsRejectionReason.NoOrigin);
    }

    const allowedOrigin = await this.matchOrigin(origin, request);

    if (isErr(allowedOrigin)) {
      return allowedOrigin;
    }

    if (allowedOrigin === undefined) {
      return this.reject(CorsRejectionReason.OriginNotAllowed);
    }

    const headers = new Headers();

    headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin);

    if (allowedOrigin !== '*') {
      headers.append(HttpHeader.Vary, HttpHeader.Origin);
    }

    if (this.options.credentials) {
      headers.set(HttpHeader.AccessControlAllowCredentials, 'true');
    }

    if (request.method !== HttpMethod.Options) {
      if (this.options.exposedHeaders !== null && this.options.exposedHeaders.length > 0) {
        const exposeHeadersValue = this.serializeExposeHeaders(this.options.exposedHeaders);

        if (exposeHeadersValue !== undefined) {
          headers.set(HttpHeader.AccessControlExposeHeaders, exposeHeadersValue);
        }
      }

      return { action: CorsAction.Continue, headers };
    }

    const requestMethod = request.headers.get(HttpHeader.AccessControlRequestMethod);

    if (requestMethod === null || requestMethod.length === 0) {
      return { action: CorsAction.Continue, headers };
    }

    if (!this.isMethodAllowed(requestMethod, this.options.methods)) {
      return this.reject(CorsRejectionReason.MethodNotAllowed);
    }

    const allowMethodsValue = this.serializeAllowedMethods(this.options.methods, requestMethod);

    headers.set(HttpHeader.AccessControlAllowMethods, allowMethodsValue);

    headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestMethod);

    const requestHeadersRaw = request.headers.get(HttpHeader.AccessControlRequestHeaders);
    const requestHeaders = this.parseCommaSeparatedValues(requestHeadersRaw);

    if (this.options.allowedHeaders !== null) {
      if (!this.areRequestHeadersAllowed(requestHeaders, this.options.allowedHeaders)) {
        return this.reject(CorsRejectionReason.HeaderNotAllowed);
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

    if (this.options.maxAge !== null) {
      headers.set(HttpHeader.AccessControlMaxAge, this.options.maxAge.toString());
    }

    if (this.options.preflightContinue) {
      return { action: CorsAction.Continue, headers };
    }

    return { action: CorsAction.RespondPreflight, headers, statusCode: this.options.optionsSuccessStatus };
  }

  private reject(reason: CorsRejectionReason): CorsRejectResult {
    return { action: CorsAction.Reject, reason };
  }

  private async matchOrigin(origin: string, request: Request): Promise<string | undefined | Err<CorsError>> {
    const originOption = this.options.origin;

    if (originOption === false) {
      return undefined;
    }

    if (originOption === '*') {
      return '*';
    }

    if (typeof originOption === 'string') {
      return originOption === origin ? originOption : undefined;
    }

    if (typeof originOption === 'boolean') {
      return originOption ? origin : undefined;
    }

    if (originOption instanceof RegExp) {
      originOption.lastIndex = 0;
      return originOption.test(origin) ? origin : undefined;
    }

    if (Array.isArray(originOption)) {
      const matched = originOption.some(entry => {
        if (entry instanceof RegExp) {
          entry.lastIndex = 0;
          return entry.test(origin);
        }

        return entry === origin;
      });

      return matched ? origin : undefined;
    }

    try {
      const originResult = await originOption(origin, request);

      return this.resolveOriginResult(origin, originResult);
    } catch {
      return err<CorsError>({
        reason: CorsErrorReason.OriginFunctionError,
        message: 'Origin function threw an error',
      });
    }
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

  private serializeExposeHeaders(exposedHeaders: string[]): string | undefined {
    if (this.options.credentials && this.includesWildcard(exposedHeaders)) {
      const explicit = exposedHeaders.filter(header => header.trim() !== '*');

      return explicit.length > 0 ? explicit.join(',') : undefined;
    }

    return exposedHeaders.join(',');
  }

  private isMethodAllowed(requestMethod: string, allowedMethods: Array<string>): boolean {
    if (this.includesWildcard(allowedMethods)) {
      return true;
    }

    return allowedMethods.includes(requestMethod);
  }

  private serializeAllowedMethods(allowedMethods: Array<string>, requestMethod: string): string {
    if (!this.includesWildcard(allowedMethods)) {
      return allowedMethods.join(',');
    }

    if (this.options.credentials) {
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

      if (!this.options.credentials) {
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

    if (this.options.credentials) {
      if (requestHeadersRaw !== null && requestHeadersRaw.length > 0) {
        return requestHeadersRaw;
      }

      return undefined;
    }

    return '*';
  }

  private includesWildcard(values: string[]): boolean {
    return values.some(value => value === '*');
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
