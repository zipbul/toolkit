/**
 * Micro-benchmark — run with `bun test test/helmet.bench.ts` (always passes;
 * surfaces ops/s in the test output for hand-eyeballing).
 *
 * Hot paths exercised:
 *   - headersRecord() with no nonce        (cache hit)
 *   - headersRecord({ nonce })             (template substitution)
 *   - applyHeadersTo(headers, { nonce })   (in-place mutation)
 *   - apply(response, { nonce })           (Response wrapping)
 */
import { describe, it } from 'bun:test';

import { Csp, Helmet } from '../index';

const helmet = Helmet.create();
const nonce = Helmet.generateNonce();

// Pathological config: many directives, many sources, many PP features.
const heavy = Helmet.create({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: [Csp.Self],
      scriptSrc: Array.from({ length: 32 }, (_, i) => `https://cdn${i}.example`),
      styleSrc: Array.from({ length: 16 }, (_, i) => `https://styles${i}.example`),
      imgSrc: Array.from({ length: 32 }, (_, i) => `https://img${i}.example`),
      connectSrc: Array.from({ length: 16 }, (_, i) => `https://api${i}.example`),
      fontSrc: [Csp.Self],
      frameAncestors: [Csp.None],
      objectSrc: [Csp.None],
      baseUri: [Csp.Self],
      formAction: [Csp.Self],
      manifestSrc: [Csp.Self],
      upgradeInsecureRequests: true,
    },
  },
});

function bench(label: string, iters: number, fn: () => void) {
  // warm-up
  for (let i = 0; i < 1000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsed = performance.now() - t0;
  const opsPerSec = Math.round((iters / elapsed) * 1000);
  // eslint-disable-next-line no-console
  console.log(`bench ${label.padEnd(40)} ${opsPerSec.toLocaleString()} ops/s`);
}

describe('benches', () => {
  it('headersRecord (cache hit)', () => {
    bench('headersRecord()', 100_000, () => {
      helmet.headersRecord();
    });
  });

  it('headersRecord with nonce', () => {
    bench('headersRecord({ nonce })', 50_000, () => {
      helmet.headersRecord({ nonce });
    });
  });

  it('applyHeadersTo with nonce', () => {
    bench('applyHeadersTo({ nonce })', 50_000, () => {
      helmet.applyHeadersTo(new Headers(), { nonce });
    });
  });

  it('apply Response with nonce', () => {
    bench('apply(Response, { nonce })', 30_000, () => {
      helmet.apply(new Response('x', { status: 200 }), { nonce });
    });
  });

  it('headers() default (no nonce)', () => {
    bench('headers() no nonce', 100_000, () => {
      helmet.headers();
    });
  });

  it('headers({ nonce })', () => {
    bench('headers({ nonce })', 50_000, () => {
      helmet.headers({ nonce });
    });
  });

  it('headers() heavy CSP no nonce', () => {
    bench('headers() heavy CSP no nonce', 50_000, () => {
      heavy.headers();
    });
  });

  it('headers() heavy CSP with nonce', () => {
    bench('headers() heavy CSP w/ nonce', 30_000, () => {
      heavy.headers({ nonce });
    });
  });
});
