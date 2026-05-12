/**
 * L) Compare validateMethodToken implementations:
 *   1. current — char-by-char tchar charCode switch
 *   2. regex — `/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(method)`
 *   3. lookup table — `Uint8Array[256]` with 1 for tchar, 0 otherwise
 *
 * Test on (a) hot path with valid known tokens (after H fix this should
 * never run, but we measure for completeness), (b) cold path with
 * varying-length and varying-validity tokens.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

// Approach 1 — current
function isValidCurrent(method: string): boolean {
  const len = method.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    const c = method.charCodeAt(i);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) continue;
    if (c === 0x21 || c === 0x23 || c === 0x24 || c === 0x25 || c === 0x26 ||
        c === 0x27 || c === 0x2a || c === 0x2b || c === 0x2d || c === 0x2e ||
        c === 0x5e || c === 0x5f || c === 0x60 || c === 0x7c || c === 0x7e) continue;
    return false;
  }
  return true;
}

// Approach 2 — regex
const TCHAR_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
function isValidRegex(method: string): boolean { return TCHAR_RE.test(method); }

// Approach 3 — lookup table
const TCHAR_TABLE = new Uint8Array(256);
(() => {
  // ALPHA
  for (let c = 0x41; c <= 0x5a; c++) TCHAR_TABLE[c] = 1;
  for (let c = 0x61; c <= 0x7a; c++) TCHAR_TABLE[c] = 1;
  // DIGIT
  for (let c = 0x30; c <= 0x39; c++) TCHAR_TABLE[c] = 1;
  // tchar specials
  for (const c of [0x21,0x23,0x24,0x25,0x26,0x27,0x2a,0x2b,0x2d,0x2e,0x5e,0x5f,0x60,0x7c,0x7e]) {
    TCHAR_TABLE[c] = 1;
  }
})();
function isValidTable(method: string): boolean {
  const len = method.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    if (TCHAR_TABLE[method.charCodeAt(i)] === 0) return false;
  }
  return true;
}

const SHORT = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'];
const LONG  = ['PROPFIND','MKCALENDAR','UPDATEREDIRECTREF','BASELINE-CONTROL'];
const INVALID = ['get<>','POST ','PUT?','BAD\nNAME'];

function bencher(label: string, samples: string[]) {
  console.log(`\n=== ${label} (${samples.length} tokens × 1024 calls/op) ===`);
  summary(() => {
    bench('current charCode switch', () => {
      let acc = 0;
      for (let r = 0; r < 1024; r++) for (const m of samples) if (isValidCurrent(m)) acc++;
      do_not_optimize(acc);
    });
    bench('regex /^.../',           () => {
      let acc = 0;
      for (let r = 0; r < 1024; r++) for (const m of samples) if (isValidRegex(m)) acc++;
      do_not_optimize(acc);
    });
    bench('Uint8Array[256] table',  () => {
      let acc = 0;
      for (let r = 0; r < 1024; r++) for (const m of samples) if (isValidTable(m)) acc++;
      do_not_optimize(acc);
    });
  });
}

async function main() {
  // sanity
  for (const m of [...SHORT, ...LONG]) {
    if (!isValidCurrent(m) || !isValidRegex(m) || !isValidTable(m)) {
      console.error('disagreement on valid:', m);
      process.exit(1);
    }
  }
  for (const m of INVALID) {
    if (isValidCurrent(m) || isValidRegex(m) || isValidTable(m)) {
      console.error('disagreement on invalid:', m);
      process.exit(1);
    }
  }
  bencher('short tokens (3-7 chars, all valid)', SHORT);
  bencher('long tokens (8-18 chars, all valid)', LONG);
  bencher('invalid tokens (mixed lengths)', INVALID);

  await run();
}

main();
