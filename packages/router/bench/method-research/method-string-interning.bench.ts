/**
 * Empirical test: does Bun.serve hand the same JS string instance for
 * `request.method` across distinct requests? If so, the router's emitted
 * `if (method !== "GET")` check could collapse to a pointer compare —
 * if not, JSC must still walk the bytes.
 *
 * Test design: spin up a tiny Bun.serve, send N requests, capture the
 * `request.method` references in a Set keyed by SameValue identity.
 * Distinct identity counts mean each request allocated a fresh string;
 * a count of 1 per distinct method means full interning.
 */

const PORT = 38791 + Math.floor(Math.random() * 100);

async function main() {
  const observed = new Map<string, { count: number; firstRef: string }>();
  let primitiveSameRefHits = 0; // Same value across requests (always true for primitives).
  let totalReqs = 0;

  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const m = req.method; // primitive string
      totalReqs++;
      const seen = observed.get(m);
      if (seen === undefined) {
        observed.set(m, { count: 1, firstRef: m });
      } else {
        seen.count++;
        // Object.is for primitives is value-equal — always true. Useful for
        // showing primitive (not boxed) semantics.
        if (Object.is(seen.firstRef, m)) primitiveSameRefHits++;
      }
      return new Response('ok');
    },
  });

  const METHODS = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'];
  const N = 5000;

  // Warm up
  for (let i = 0; i < 50; i++) {
    await fetch(`http://localhost:${PORT}/`, { method: METHODS[i % METHODS.length] });
  }

  const t0 = performance.now();
  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    promises.push(fetch(`http://localhost:${PORT}/`, { method: METHODS[i % METHODS.length] }));
  }
  await Promise.all(promises);
  const dt = performance.now() - t0;

  server.stop();

  // ── Analysis ──
  console.log(`\n=== Bun.serve method primitive observation ===`);
  console.log(`total requests handled: ${totalReqs} in ${dt.toFixed(0)}ms`);
  console.log(`distinct method values observed: ${observed.size}`);
  for (const [m, info] of observed) {
    console.log(`  ${m.padEnd(10)} count=${info.count}`);
  }
  console.log(`Object.is(firstRef, observedAgain) hits: ${primitiveSameRefHits} / ${totalReqs - observed.size}`);

  // ── Identity test via the JSC heap intern table ──
  // For primitive strings, `===` is value equality, never pointer-only. JSC
  // *does* maintain a string atom/intern table for short ASCII strings
  // (typically ≤ 32 chars or constant-string pool). We can probe whether
  // `req.method` returns a value that is reference-equal to a string
  // literal by relying on JSC internal optimization: if both values are
  // atoms in the same pool, V8/JSC fold them to the same heap address.
  //
  // The user-visible signal: timing of `=== "GET"` against `req.method`
  // vs. against a fresh `String("GET")` (boxed object). Boxed object never
  // matches by `===`. We measure this in a separate microbench below.

  // Microbench — compare `=== "GET"` cost on (a) literal-pool method,
  // (b) freshly built String, (c) char-by-char built string.
  const M = 1_000_000;
  const literal = 'GET';
  const concat = ['G','E','T'].join('');
  const sliced = ('AGET').slice(1);

  function timeEq(label: string, target: string) {
    let acc = 0;
    const start = performance.now();
    for (let i = 0; i < M; i++) {
      // The compare. We add to acc to prevent dead-code elim.
      if (target === 'GET') acc++;
    }
    const dt = performance.now() - start;
    console.log(`  ${label.padEnd(30)} ${(dt * 1e6 / M).toFixed(2)} ns/op  (acc=${acc})`);
    return acc;
  }

  console.log(`\n=== === compare cost (literal target vs constructed) ===`);
  timeEq('literal "GET"', literal);
  timeEq('Array.join("G","E","T")', concat);
  timeEq('"AGET".slice(1)', sliced);

  // Now compare with the actual method value Bun handed us.
  // To get one, do one more request and capture the primitive.
  const observedMethod: { value: string | null } = { value: null };
  const s2 = Bun.serve({
    port: PORT + 1,
    fetch(req) { observedMethod.value = req.method; return new Response('ok'); },
  });
  await fetch(`http://localhost:${PORT + 1}/`, { method: 'GET' });
  s2.stop();
  const bunMethod = observedMethod.value!;
  console.log(`\nbunMethod === "GET" literal? ${bunMethod === 'GET'}`);
  console.log(`Object.is(bunMethod, "GET")? ${Object.is(bunMethod, 'GET')}`);
  console.log(`bunMethod typeof: ${typeof bunMethod}, length: ${bunMethod.length}`);
  timeEq('Bun req.method', bunMethod);
}

main().catch(e => { console.error(e); process.exit(1); });
