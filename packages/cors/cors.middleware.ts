import { BunnerMiddleware, type Context } from '@bunner/common';

import type { CorsOptions } from './interfaces';

import { BunnerHttpContext } from '../../adapter';
import { HeaderField, HttpMethod } from '../../enums';
import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';

export class CorsMiddleware extends BunnerMiddleware<CorsOptions> {
  constructor(private readonly options: CorsOptions = {}) {
    super();
  }

  public async handle(context: Context): Promise<void | boolean> {
    const http = this.assertHttpContext(context);
    const req = http.request;
    const res = http.response;
    const origin = req.headers.get(HeaderField.Origin);
    const method = req.method;
    // Set defaults
    const allowedMethods = this.options.methods ?? CORS_DEFAULT_METHODS;
    const allowedHeaders = this.options.allowedHeaders;
    const exposedHeaders = this.options.exposedHeaders;
    const allowCredentials = this.options.credentials;
    const maxAge = this.options.maxAge;
    const preflightContinue = this.options.preflightContinue ?? false;
    const optionsSuccessStatus = this.options.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS;

    // Handle Origin
    if (origin === null || origin.length === 0) {
      return;
    }

    // Validate Origin and set header
    const allowedOrigin = await this.matchOrigin(origin, this.options);

    if (allowedOrigin === undefined) {
      return;
    }

    res.setHeader(HeaderField.AccessControlAllowOrigin, allowedOrigin);

    // If we echo the origin, we must set Vary: Origin
    if (allowedOrigin !== '*') {
      res.appendHeader(HeaderField.Vary, HeaderField.Origin);
    }

    // Credentials
    if (allowCredentials === true) {
      res.setHeader(HeaderField.AccessControlAllowCredentials, 'true');
    }

    // Exposed Headers (Actual Request)
    if (exposedHeaders !== undefined) {
      const headerValue = Array.isArray(exposedHeaders) ? exposedHeaders.join(',') : exposedHeaders;

      if (headerValue.length > 0) {
        res.setHeader(HeaderField.AccessControlExposeHeaders, headerValue);
      }
    }

    // Handle Preflight
    if (method === (HttpMethod.Options as string)) {
      // Access-Control-Request-Method
      const requestMethod = req.headers.get(HeaderField.AccessControlRequestMethod);

      if (requestMethod === null || requestMethod.length === 0) {
        // Proceed if not a valid preflight
        return;
      }

      // Access-Control-Allow-Methods
      if (allowedMethods !== undefined) {
        const headerValue = Array.isArray(allowedMethods) ? allowedMethods.join(',') : allowedMethods;

        if (headerValue.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowMethods, headerValue);
        } else {
          res.setHeader(HeaderField.AccessControlAllowMethods, '');
        }
      }

      // Access-Control-Allow-Headers
      if (allowedHeaders !== undefined) {
        const headerValue = Array.isArray(allowedHeaders) ? allowedHeaders.join(',') : allowedHeaders;

        if (headerValue.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowHeaders, headerValue);
        }
      } else {
        // If not specified, reflect request headers
        const requestHeaders = req.headers.get(HeaderField.AccessControlRequestHeaders);

        if (typeof requestHeaders === 'string' && requestHeaders.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowHeaders, requestHeaders);
          res.appendHeader(HeaderField.Vary, HeaderField.AccessControlRequestHeaders);
        }
      }

      // Access-Control-Max-Age
      if (maxAge !== undefined) {
        res.setHeader(HeaderField.AccessControlMaxAge, maxAge.toString());
      }

      if (preflightContinue) {
        return;
      }

      // End response with success status
      res.setStatus(optionsSuccessStatus);

      return false;
    }
  }

  private assertHttpContext(context: Context): BunnerHttpContext {
    if (context instanceof BunnerHttpContext) {
      return context;
    }

    throw new Error('Expected BunnerHttpContext');
  }

  private async matchOrigin(origin: string, options: CorsOptions): Promise<string | undefined> {
    if (options.origin === false) {
      return undefined;
    }

    const originOption = options.origin;

    if (originOption === undefined || originOption === '*') {
      return options.credentials === true ? origin : '*';
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
      const matched = originOption.some(o => {
        if (o instanceof RegExp) {
          return o.test(origin);
        }

        return o === origin;
      });

      return matched ? origin : undefined;
    }

    if (typeof originOption === 'function') {
      return new Promise<string | undefined>(resolve => {
        originOption(origin, (err, allow) => {
          if (err !== null || allow !== true) {
            resolve(undefined);
          } else {
            resolve(origin);
          }
        });
      });
    }

    return undefined;
  }
}
