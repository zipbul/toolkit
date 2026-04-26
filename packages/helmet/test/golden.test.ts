import { describe, expect, it } from 'bun:test';

import { Helmet } from '../index';

const PERMISSIONS_DEFAULT =
  'publickey-credentials-get=(), publickey-credentials-create=(), identity-credentials-get=(), digital-credentials-get=(), digital-credentials-create=(), otp-credentials=(), accelerometer=(), ambient-light-sensor=(), attribution-reporting=(), autoplay=(), battery=(), bluetooth=(), camera=(), compute-pressure=(), cross-origin-isolated=(), direct-sockets=(), display-capture=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), keyboard-map=(), magnetometer=(), mediasession=(), microphone=(), midi=(), navigation-override=(), payment=(), picture-in-picture=(), screen-wake-lock=(), serial=(), storage-access=(), sync-xhr=(self), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()';

function snapshot(helmet: Helmet, opts?: { nonce?: string }): Record<string, string> {
  const record = helmet.headersRecord(opts);
  const out: Record<string, string> = {};
  for (const k of Object.keys(record).sort()) out[k] = record[k]!;
  return out;
}

describe('golden — Default-ON', () => {
  it('matches the OWASP-aligned baseline', () => {
    expect(snapshot(Helmet.create())).toEqual({
      'content-security-policy':
        "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; object-src 'none'; upgrade-insecure-requests; script-src 'self'; style-src 'self'",
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'origin-agent-cluster': '?1',
      'permissions-policy': PERMISSIONS_DEFAULT,
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-dns-prefetch-control': 'off',
      'x-frame-options': 'deny',
      'x-permitted-cross-domain-policies': 'none',
    });
  });

  it('Default-ON + nonce — script-src/style-src carry the nonce exactly once', () => {
    const snap = snapshot(Helmet.create(), { nonce: 'AAAAAAAAAAAAAAAA' });
    expect(snap['content-security-policy']).toBe(
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; object-src 'none'; upgrade-insecure-requests; script-src 'self' 'nonce-AAAAAAAAAAAAAAAA'; style-src 'self' 'nonce-AAAAAAAAAAAAAAAA'",
    );
  });
});
