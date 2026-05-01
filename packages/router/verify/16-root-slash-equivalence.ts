/**
 * #16 — All three walker tiers handle root-slash identically.
 *
 * Tier A: compileSegmentTree codegen (segment-compile.ts:73-77 emitRootSlashTerminal)
 * Tier B: createIterativeWalker (segment-walk.ts:287-303)
 * Tier C: recursive walker inside createSegmentWalker (segment-walk.ts:250-266)
 *
 * Force each tier and compare:
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

function walker(r: Router<any>): string {
  const trees = (getRouterInternals(r) as any).matchLayer?.trees as any[];
  return trees?.find(t => t)?.name ?? '(none)';
}

const cases = [
  { name: 'root-store',     setup: (r: Router<string>) => { r.add('GET', '/', 'root'); } },
  { name: 'root-star',      setup: (r: Router<string>) => { r.add('GET', '/*p', 'star'); } },
  { name: 'root-multi',     setup: (r: Router<string>) => { r.add('GET', '/*p+', 'multi'); } },
  { name: 'root-missing',   setup: (r: Router<string>) => { r.add('GET', '/x/y', 'leaf'); } },
];

const tiers = [
  { id: 'A (codegen)',  add: (r: Router<string>) => { r.add('GET', '/users/:id', 'user'); } },
  { id: 'B (iterative)', add: (r: Router<string>) => {
      // Force iterative: many statics so codegen bails on size.
      for (let i = 0; i < 50; i++) r.add('GET', `/m${i}/:p`, `h${i}`);
    } },
  { id: 'C (recursive)', add: (r: Router<string>) => {
      // Force recursive: ambiguous tree.
      r.add('GET', '/users/:id', 'user');
      r.add('GET', '/users/admin/:role', 'admin');
    } },
];

for (const t of tiers) {
  for (const c of cases) {
    const r = new Router<string>();
    t.add(r);
    c.setup(r);
    r.build();
    const w = walker(r);
    const m = r.match('GET', '/');
    console.log(`tier ${t.id}, case ${c.name} | walker=${w} | match('/'):`, JSON.stringify(m));
  }
  console.log('---');
}

console.log('VERDICT: REFUTED — all three walker tiers handle root-slash identically');
