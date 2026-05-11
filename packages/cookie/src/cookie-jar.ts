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
        // Bun.CookieMap silently substitutes U+FFFD for invalid percent-encoding (`%XX` malformed).
        // Drop those entries — silent corruption of cookie values is unacceptable for crypto / app code.
        if (value.includes('�') || name.includes('�')) continue;
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
    // For deletion, the parser may have defaults (e.g. sameSite='none' + secure='auto') that would
    // throw at serialize time when the request is insecure. We only fill defaults — explicit user
    // input is honored verbatim so cross-site deletions (sameSite:'none' + secure:true) are possible.
    const overrides: CookieAttributes = {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    };
    if (options?.sameSite === undefined) {
      overrides.sameSite = 'lax';
    }
    if (options?.secure === undefined) {
      overrides.secure = false;
    }
    const cookie = this.parser.createCookie(name, '', overrides);
    this.outbound.set(name, { cookie, deleted: true });
  }

  public async getSetCookieHeaders(context?: SerializeContext): Promise<string[]> {
    const tasks: Promise<string>[] = [];

    for (const [, entry] of this.outbound) {
      if (entry.deleted) {
        tasks.push(Promise.resolve(this.parser.serialize(entry.cookie, context)));
        continue;
      }
      tasks.push(this.transformAndSerialize(entry.cookie, context));
    }

    return Promise.all(tasks);
  }

  private async transformAndSerialize(cookie: Cookie, context?: SerializeContext): Promise<string> {
    let c = cookie;
    if (this.parser.isSigningConfigured) {
      c = this.parser.sign(c);
    }
    if (this.parser.isEncryptionConfigured) {
      c = await this.parser.encrypt(c);
    }
    return this.parser.serialize(c, context);
  }

  private toErr(thrown: unknown, step: Step): ReturnType<typeof err<CookieErrorData>> {
    if (thrown instanceof CookieError) {
      return err<CookieErrorData>({
        reason: thrown.reason,
        message: thrown.message,
      });
    }
    return err<CookieErrorData>({
      reason: step === 'decrypt'
        ? CookieErrorReason.DecryptionFailed
        : CookieErrorReason.SignatureVerificationFailed,
      message: thrown instanceof Error ? thrown.message : 'unknown cookie error',
    });
  }
}
