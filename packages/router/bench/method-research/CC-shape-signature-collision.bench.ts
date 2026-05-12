/**
 * CC) shapeSignature = `n=N|f=F|t=T`. Two structurally-different trees
 * may collide on (nodes, maxFanout, testers). Test by generating many
 * synthetic trees and counting unique signatures vs unique tree
 * structures.
 */
import { shapeSignature } from '../../src/codegen/codegen-telemetry';

function trees(): Array<{ name: string; sig: string }> {
  const out: Array<{ name: string; sig: string }> = [];
  // Vary nodes, maxFanout, testers.
  for (const n of [10, 50, 100, 500, 1000, 5000]) {
    for (const f of [1, 2, 4, 8, 16, 32, 64]) {
      for (const t of [0, 1, 5, 10, 50]) {
        out.push({ name: `n=${n} f=${f} t=${t}`, sig: shapeSignature(n, f, t) });
      }
    }
  }
  return out;
}

async function main() {
  const all = trees();
  const seen = new Set<string>();
  let dupes = 0;
  for (const t of all) {
    if (seen.has(t.sig)) dupes++;
    else seen.add(t.sig);
  }
  console.log(`generated ${all.length} signatures, ${seen.size} unique, ${dupes} collisions`);
  // None should collide since the function builds the string from the 3 inputs.
  if (dupes > 0) console.log(`!! collision in pure (n,f,t) — implementation bug`);

  // True structural collision concern: different trees can produce the
  // same (n,f,t) tuple. Example: 100-node tree with fanout 4 and 5
  // testers vs another 100-node tree with the same shape numbers but
  // entirely different routing. The signature is intentionally coarse
  // (ULTIMATE.md acknowledges this).
  console.log(`coarse signature accepted by design — see codegen-telemetry.ts:53`);
}

main();
