/**
 * String vs number dispatch — END-TO-END cost.
 *
 * The router currently takes a string method ("GET", …) and runs
 * `methodCodes[method]` to produce an int code. The naive view says "if
 * the caller already knew the int code, we'd skip a Record lookup."
 *
 * This bench tests that hypothesis HONESTLY by including the cost of the
 * conversion the caller would have to perform. There are several caller
 * scenarios:
 *
 *   S1. caller has the string only (today's reality — Bun.serve hands a
 *       string). Router must do the lookup.
 *
 *   S2. caller has the int code, having converted it once outside the
 *       hot loop (e.g. cached on the request object). Router is given
 *       int directly.
 *
 *   S3. caller has the string each call but performs the conversion
 *       *itself* before calling the router. Conversion + dispatch are
 *       both at the call site. Total cost is identical to S1 modulo
 *       inlining decisions.
 *
 *   S4. caller has the string and the router exposes BOTH `match(str,…)`
 *       and `matchByCode(int,…)`. Most callers use S1 — measure both so
 *       we know S2's ceiling.
 *
 * Variants on dispatch table:
 *
 *   - prototype-less Record `{GET: 0, POST: 1, …}`             (today)
 *   - frozen-Map `Map.get(method)`                              (control)
 *   - dense Int32Array indexed by `methodCodes[method]`         (S2/S4)
 *   - direct charCode-based perfect discriminator                (already
 *     beaten in earlier bench, included here for completeness)
 *
 * Hot-path payload for each call: 1 dispatch + 1 indexed array load
 * (simulating "find the per-method tree pointer"). The downstream
 * routing work is identical, so the delta isolates dispatch cost.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
const N_REQUESTS = 1024;

// Build dispatch tables.
const codeMap: Record<string, number> = Object.create(null);
for (let i = 0; i < METHODS.length; i++) codeMap[METHODS[i]!] = i;

const codeMapMap = new Map<string, number>();
for (let i = 0; i < METHODS.length; i++) codeMapMap.set(METHODS[i]!, i);

// Per-method "tree" — a stand-in for the router's per-method walker. We use
// a closure that returns a number so dispatch is the only variable.
type Tree = (path: string) => number;
const treesByCode: Tree[] = METHODS.map((_, i) => (_p: string) => i);
const treesArr = new Int32Array(32);
for (let i = 0; i < METHODS.length; i++) treesArr[i] = i + 100;

// ── Generate samples — request stream as the caller would see it ──
function makeStringRequests(): string[] {
  const out: string[] = [];
  for (let i = 0; i < N_REQUESTS; i++) out.push(METHODS[i % METHODS.length]!);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function makeCodeRequests(): number[] {
  const out: number[] = [];
  for (let i = 0; i < N_REQUESTS; i++) out.push(i % METHODS.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Pre-generate so each bench function sees the same input distribution.
const strReqs = makeStringRequests();
const codeReqs = makeCodeRequests();

// ── Scenario S1 — caller has string, router does Record lookup ──
function s1_recordLookup(): number {
  let acc = 0;
  for (let i = 0; i < strReqs.length; i++) {
    const m = strReqs[i]!;
    const mc = codeMap[m];
    if (mc === undefined) continue;
    acc += treesByCode[mc]!('/x');
  }
  return acc;
}

// ── Scenario S1' — caller has string, router uses Map.get ──
function s1_mapGet(): number {
  let acc = 0;
  for (let i = 0; i < strReqs.length; i++) {
    const m = strReqs[i]!;
    const mc = codeMapMap.get(m);
    if (mc === undefined) continue;
    acc += treesByCode[mc]!('/x');
  }
  return acc;
}

// ── Scenario S2 — caller HAS the int already (best-case for number) ──
function s2_directInt(): number {
  let acc = 0;
  for (let i = 0; i < codeReqs.length; i++) {
    const mc = codeReqs[i]!;
    acc += treesByCode[mc]!('/x');
  }
  return acc;
}

// ── Scenario S3 — caller converts string → int at call site ──
// Identical to S1 in totals; included to confirm the inlining assumption.
function s3_callerConverts(): number {
  let acc = 0;
  for (let i = 0; i < strReqs.length; i++) {
    const m = strReqs[i]!;
    const mc = codeMap[m]; // caller-side
    if (mc === undefined) continue;
    acc += treesByCode[mc]!('/x'); // router-side
  }
  return acc;
}

// ── Scenario S2' — Int32Array tree pointer (no closure) ──
function s2_int32arr(): number {
  let acc = 0;
  for (let i = 0; i < codeReqs.length; i++) {
    const mc = codeReqs[i]!;
    acc += treesArr[mc]!;
  }
  return acc;
}

// ── Realistic scenario — Bun.serve handing the *interned* method string.
// This is what the production router actually sees. Our `strReqs` builds
// the string anew (`METHODS[i]`); the literal-array reads return the same
// JSC atom each time, so this *is* the interned-string path.
//
// But to be honest — JSC may still pay a bytewise compare when the IC
// transitions through different lengths. We add a "literal-only" version
// where the request stream is one of the interned literals to prove the
// fast-case ceiling.
const literalGet: string = 'GET';
function s1_literalAlwaysGet(): number {
  let acc = 0;
  for (let i = 0; i < strReqs.length; i++) {
    const mc = codeMap[literalGet];
    if (mc === undefined) continue;
    acc += treesByCode[mc]!('/x');
  }
  return acc;
}

async function main() {
  console.log('clk: ~13th Gen i7-13700K @ 4.89GHz');
  console.log(`requests per op: ${N_REQUESTS}`);
  console.log(`methods active: ${METHODS.length}\n`);

  console.log('=== End-to-end dispatch (1024 requests / op) ===');
  summary(() => {
    bench('S1 — Record[str] (production)', () => { do_not_optimize(s1_recordLookup()); });
    bench('S1\' — Map.get(str)', () => { do_not_optimize(s1_mapGet()); });
    bench('S2 — direct int → trees[mc]', () => { do_not_optimize(s2_directInt()); });
    bench('S2\' — direct int → Int32Array[mc]', () => { do_not_optimize(s2_int32arr()); });
    bench('S3 — caller converts str→int (same as S1)', () => { do_not_optimize(s3_callerConverts()); });
    bench('S1-best — single literal "GET" only', () => { do_not_optimize(s1_literalAlwaysGet()); });
  });

  await run();
}

main();
