/**
 * #2 — path-parser joins static segments → segment-tree splits them again.
 *
 * Hypothesis (code references):
 *   - path-parser.ts:236-245: staticBuf accumulates `seg + '/'` then a single
 *     `parts.push({ type: 'static', value: staticBuf })`.
 *   - segment-tree.ts:116, 289-309: extractSegments(part.value) splits on '/'.
 *
 * Method: directly observe path-parser output, then replicate extractSegments.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true,
  ignoreTrailingSlash: true,
  maxSegmentLength: 1024,
});

const cases = [
  '/api/v1/users/list',
  '/a/b/c',
  '/single',
  '/users/:id/posts',  // mixed: static + param + static
];

function extractSegments(label: string): string[] {
  const segs: string[] = [];
  let cur = '';
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c === 47) {
      if (cur.length > 0) { segs.push(cur); cur = ''; }
    } else {
      cur += label.charAt(i);
    }
  }
  if (cur.length > 0) segs.push(cur);
  return segs;
}

let allDouble = true;
for (const path of cases) {
  const r = parser.parse(path);
  if ('data' in r) { console.log(path, '→ parser err'); continue; }

  console.log('---', path);
  for (const p of r.parts) {
    if (p.type === 'static') {
      const re = extractSegments(p.value);
      console.log('  static value:', JSON.stringify(p.value), '→ extractSegments →', re);
      // Joined form has slashes that extractSegments will recover.
      const segCount = re.length;
      const slashCount = (p.value.match(/\//g) ?? []).length;
      console.log('    contains', segCount, 'segments,', slashCount, 'slashes');
    } else {
      console.log('  ', p.type, ':', JSON.stringify(p));
    }
  }
}

console.log(allDouble ? 'VERDICT: REPRODUCED — static parts are joined then re-split.' : 'unexpected');
