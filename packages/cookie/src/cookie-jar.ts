import { Cookie } from 'bun';
import { err } from '@zipbul/result';
import type { ResultAsync } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import { CookieError } from './interfaces';
import type { CookieAttributes, CookieErrorData, SerializeContext } from './interfaces';
import type { CookieParser } from './cookie-parser';

interface OutboundEntry {
  readonly cookie: Cookie;
  readonly deleted: boolean;
}

type Step = 'decrypt' | 'unsign';

export class CookieJar {
  private readonly inbound: ReadonlyMap<string, string>;
  private readonly outbound = new Map<string, OutboundEntry>();

  constructor(
    private readonly parser: CookieParser,
    cookieHeader: string,
  ) {
    const parsed = new Map<string, string>();
    if (cookieHeader !== '') {
      const map = new Bun.CookieMap(cookieHeader);
      for (const [name, value] of map) {
        parsed.set(name, value);
      }
    }
    this.inbound = parsed;
  }

  public has(name: string): boolean {
    return this.inbound.has(name);
  }

  public getRaw(name: string): string | undefined {
    return this.inbound.get(name);
  }

  public async get(name: string): ResultAsync<string | null, CookieErrorData> {
    const raw = this.inbound.get(name);
    if (raw === undefined) return null;

    let cookie = new Cookie(name, raw);

    if (this.parser.isEncryptionConfigured) {
      try {
        cookie = await this.parser.decrypt(cookie);
      } catch (thrown) {
        return this.toErr(thrown, 'decrypt');
      }
    }

    if (this.parser.isSigningConfigured) {
      try {
        cookie = await this.parser.unsign(cookie);
      } catch (thrown) {
        return this.toErr(thrown, 'unsign');
      }
    }

    return cookie.value;
  }

  public set(name: string, value: string, options?: CookieAttributes): void {
    const cookie = this.parser.createCookie(name, value, options);
    this.outbound.set(name, { cookie, deleted: false });
  }

  public delete(name: string, options?: CookieAttributes): void {
    const cookie = this.parser.createCookie(name, '', {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    });
    this.outbound.set(name, { cookie, deleted: true });
  }

  public async getSetCookieHeaders(context?: SerializeContext): Promise<string[]> {
    const headers: string[] = [];

    for (const [, entry] of this.outbound) {
      if (entry.deleted) {
        headers.push(this.parser.serialize(entry.cookie, context));
        continue;
      }

      let cookie = entry.cookie;

      if (this.parser.isSigningConfigured) {
        cookie = this.parser.sign(cookie);
      }

      if (this.parser.isEncryptionConfigured) {
        cookie = await this.parser.encrypt(cookie);
      }

      headers.push(this.parser.serialize(cookie, context));
    }

    return headers;
  }

  private toErr(thrown: unknown, step: Step): ReturnType<typeof err<CookieErrorData>> {
    if (thrown instanceof CookieError) {
      return err<CookieErrorData>({
        reason: thrown.reason,
        message: thrown.message,
      });
    }
    // M1 fix: fallback reason reflects the step that actually failed
    return err<CookieErrorData>({
      reason: step === 'decrypt'
        ? CookieErrorReason.DecryptionFailed
        : CookieErrorReason.SignatureVerificationFailed,
      message: thrown instanceof Error ? thrown.message : 'unknown cookie error',
    });
  }
}
