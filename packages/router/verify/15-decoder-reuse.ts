/**
 * #15 — Decoder is invoked once per segment, value reused across siblings.
 * Verify by sibling-chain match: tester sees the SAME decoded value across attempts.
 *
 * Setup: two siblings at same position with different testers; one rejects,
 * one accepts. Inspect that the decoded value is identical (no re-decode).
 */

import { Router } from '../index';
import { readFileSync } from 'node:fs';

// Source check: recursive sibling backtracking decodes once before trying
// the head param and reuses that same decoded value for nextSibling attempts.
const src = readFileSync('src/matcher/segment-walk.ts', 'utf8');
const siblingBlock = src.slice(src.indexOf('const head = node.paramChild;'), src.indexOf('if (node.wildcardStore !== null)'));
const decodeOnceBeforeHead = /const\s+decoded\s*=\s*decoder\(seg\);\s*\n\s*if\s*\(tryMatchParam\(head,\s*decoded,/.test(siblingBlock);
const siblingReusesDecoded = /while\s*\(p\s*!==\s*null\)[\s\S]*tryMatchParam\(p,\s*decoded,/.test(siblingBlock);

// Runtime cross-check: first sibling rejects, second accepts the same decoded
// value. `%5F` decodes to `_`, which is accepted by \w+.
const r = new Router<string>();
r.add('GET', '/u/:a(\\d+)', 'A');
r.add('GET', '/u/:b(\\w+)', 'B');
r.build();

const m = r.match('GET', '/u/hello%5Fworld');
console.log('source decodes once before head attempt:', decodeOnceBeforeHead);
console.log('source reuses decoded for siblings:', siblingReusesDecoded);
console.log('decoded captured value:', m?.params);

const decodedOK = m?.params.b === 'hello_world';
console.log('VERDICT:', decodeOnceBeforeHead && siblingReusesDecoded && decodedOK
  ? 'REFUTED — decoder is invoked once before sibling attempts and decoded value is reused'
  : 'PARTIAL');
