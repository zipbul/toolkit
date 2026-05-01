/**
 * #51 — activeParams.clear() at start of parseTokens — JS single-threaded
 *       so no race; verify multi-call safety.
 */

import { PathParser } from '../src/builder/path-parser';
import { isErr } from '@zipbul/result';

const parser = new PathParser({
  caseSensitive: true, ignoreTrailingSlash: true, maxSegmentLength: 1024,
});

// Sequential parses with same param names — second must not see stale state.
const a = parser.parse('/x/:id');
const b = parser.parse('/y/:id');  // same name, different path
const c = parser.parse('/z/:id/:foo');

const aOK = !isErr(a) && a.parts.length === 2;
const bOK = !isErr(b) && b.parts.length === 2;
const cOK = !isErr(c) && c.parts.length === 4;

console.log('parse /x/:id:    ', aOK);
console.log('parse /y/:id:    ', bOK);
console.log('parse /z/:id/:foo:', cOK);
console.log('VERDICT:', aOK && bOK && cOK
  ? 'REFUTED — clear() resets state; sequential parses safe'
  : 'PARTIAL');
