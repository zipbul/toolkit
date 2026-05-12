/**
 * C) Verify Bun.serve interns *custom* (non-default-7) HTTP method
 * tokens the same way it interns the well-known verbs. Earlier bench
 * confirmed `req.method === "GET"` is essentially a pointer compare;
 * we never tested PROPFIND, MKCOL, or arbitrary user tokens.
 *
 * If interning is universal, the router's single-method codegen
 * `if (method !== "<custom>")` is fast for any token. If interning is
 * limited (e.g. only the known verbs in JSC's atom pool, or only short
 * tokens), custom-method routers pay full bytewise compare cost.
 */

const PORT = 38900 + Math.floor(Math.random() * 100);

const TEST_METHODS = [
  'GET',                        // default, definitely interned
  'PROPFIND',                   // WebDAV, IANA registered
  'MKCALENDAR',                 // CalDAV, IANA registered
  'UPDATEREDIRECTREF',          // longest IANA token
  'CUSTOM-X',                   // user-defined hyphen
  'A',                          // 1-char minimum
  'X'.repeat(64),               // long but valid tchar
];

async function captureMethodValues() {
  const seen = new Map<string, { ref: string; count: number; sameRefHits: number }>();

  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const m = req.method;
      const e = seen.get(m);
      if (e === undefined) {
        seen.set(m, { ref: m, count: 1, sameRefHits: 0 });
      } else {
        e.count++;
        if (Object.is(e.ref, m)) e.sameRefHits++;
      }
      return new Response('ok');
    },
  });

  // Warm
  for (const m of TEST_METHODS) {
    await fetch(`http://localhost:${PORT}/`, { method: m as any });
  }

  // Stress — each method 200 times.
  const promises: Promise<unknown>[] = [];
  for (let r = 0; r < 200; r++) {
    for (const m of TEST_METHODS) {
      promises.push(fetch(`http://localhost:${PORT}/`, { method: m as any }));
    }
  }
  await Promise.all(promises);
  server.stop();

  return seen;
}

function timeEq(label: string, target: string, literal: string, M = 5_000_000): number {
  let acc = 0;
  const t0 = performance.now();
  for (let i = 0; i < M; i++) {
    if (target === literal) acc++;
  }
  const dt = performance.now() - t0;
  const ns = (dt * 1e6) / M;
  console.log(`  ${label.padEnd(30)} ${ns.toFixed(2)} ns/op  (acc=${acc})`);
  return ns;
}

async function main() {
  console.log('=== Method interning observation ===');
  const seen = await captureMethodValues();
  for (const [m, info] of seen) {
    const display = m.length > 32 ? m.slice(0, 16) + `…(${m.length})` : m;
    console.log(
      `  ${display.padEnd(20)} count=${info.count}, ` +
      `Object.is(firstRef, observed)=${info.sameRefHits}/${info.count - 1}`,
    );
  }

  console.log('\n=== === compare cost: Bun-handed value vs literal ===');
  // Capture one method value for each via Bun.serve.
  const PORT2 = PORT + 200;
  const captured = new Map<string, string>();
  const s2 = Bun.serve({
    port: PORT2,
    fetch(req) {
      if (!captured.has(req.method)) captured.set(req.method, req.method);
      return new Response('ok');
    },
  });
  for (const m of TEST_METHODS) {
    await fetch(`http://localhost:${PORT2}/`, { method: m as any });
  }
  s2.stop();

  for (const m of TEST_METHODS) {
    const bunVal = captured.get(m)!;
    const display = m.length > 24 ? m.slice(0, 12) + `…(${m.length})` : m;
    console.log(`\n${display}:`);
    console.log(`  Object.is(bunVal, literal)? ${Object.is(bunVal, m)}`);
    timeEq(`literal === literal`, m, m);
    timeEq(`bunVal === literal`, bunVal, m);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
