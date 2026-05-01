/**
 * #50 — `wildcard last segment` rule checked in both parseTokens (line 203)
 *       and parseWildcard (line 366). Verify both reject the same input.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true,
  ignoreTrailingSlash: true,
  maxSegmentLength: 1024,
});

// `:name+` triggers parseTokens detection (parseParam returns wildcard,
// then parseTokens checks `i !== last`).
const a = parser.parse('/:p+/x');
console.log('/:p+/x →', 'data' in a ? a.data.kind : 'parsed');

// `*name` triggers parseWildcard's own check.
const b = parser.parse('/*p/x');
console.log('/*p/x →', 'data' in b ? b.data.kind : 'parsed');

const bothReject = 'data' in a && 'data' in b
  && a.data.kind === 'route-parse' && b.data.kind === 'route-parse';
console.log('VERDICT:', bothReject
  ? 'REFUTED — both checks reject; SSoT violation but result correct'
  : 'PARTIAL');
