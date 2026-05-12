/**
 * O) Map Bun.serve method-string interning criteria. C bench showed
 * GET/PROPFIND/MKCALENDAR interned, UPDATEREDIRECTREF/CUSTOM-X/A/64char
 * NOT interned. Test more permutations:
 *   - length sweep (1, 2, 3, 4, 5, 8, 16, 17, 18, 19, 32, 64)
 *   - all known IANA tokens
 *   - tokens differing only in case
 *   - tokens with `tchar` specials
 *
 * Goal: find the rule (table-based? length-bound? specific allowlist?).
 */

const PORT = 39000 + Math.floor(Math.random() * 200);

const PROBES = [
  // length sweep using ALPHA chars — rules out tchar-specials concerns
  'A', 'AB', 'ABC', 'ABCD', 'ABCDE', 'ABCDEFGH',
  'A'.repeat(10), 'A'.repeat(16), 'A'.repeat(17),
  'A'.repeat(18), 'A'.repeat(19), 'A'.repeat(32),
  // IANA registry, sorted by length
  'GET','PUT','HEAD','POST','LOCK','MOVE','COPY','BIND','ACL',
  'PATCH','TRACE','MERGE','LABEL','LINK','PRI','QUERY',
  'DELETE','SEARCH','REPORT','UPDATE','REBIND','UNBIND','UNLINK','UNLOCK',
  'OPTIONS','CONNECT','PROPFIND','CHECKIN','CHECKOUT',
  'PROPPATCH','MKACTIVITY','MKCALENDAR','MKWORKSPACE',
  'ORDERPATCH','UNCHECKOUT','VERSION-CONTROL',
  'BASELINE-CONTROL','MKREDIRECTREF','UPDATEREDIRECTREF',
  // case variants (RFC 9112: case-sensitive, so distinct)
  'get','Get','POST_LC',
  // tchar specials
  'X-CUSTOM','MY.METHOD','ZIP+TAR',
];

async function probe(method: string, port: number): Promise<{ value: string; sameAsLiteral: boolean }> {
  let captured = '';
  const s = Bun.serve({ port, fetch(r) { captured = r.method; return new Response('ok'); } });
  try {
    await fetch(`http://localhost:${port}/`, { method: method as any });
  } catch {
    captured = '<fetch-rejected>';
  }
  s.stop();
  return { value: captured, sameAsLiteral: Object.is(captured, method) };
}

async function main() {
  console.log('=== Bun.serve method interning probe ===\n');
  console.log('METHOD'.padEnd(28), 'LEN'.padStart(4), '  capturedSame'.padEnd(16), 'value');
  console.log('-'.repeat(80));
  for (let i = 0; i < PROBES.length; i++) {
    const m = PROBES[i]!;
    const r = await probe(m, PORT + i);
    const display = m.length > 24 ? m.slice(0, 16) + '…' : m;
    console.log(
      display.padEnd(28),
      String(m.length).padStart(4),
      String(r.sameAsLiteral).padEnd(16),
      r.value.length > 32 ? r.value.slice(0, 24) + '…' : r.value,
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
