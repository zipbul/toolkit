import { bench, do_not_optimize, run, summary } from 'mitata';

import { Router } from '../src/router';
import { getRouterInternals } from '../internal';

function optionalPath(count: number): string {
  let path = '/x';

  for (let i = 0; i < count; i++) path += `/:p${i}?`;

  return path;
}

function buildOptional(count: number): Router<string> {
  const r = new Router<string>();
  r.add('GET', optionalPath(count), 'handler');
  r.build();

  return r;
}

function assertShape(count: number): void {
  const r = buildOptional(count);
  const snapshot = (getRouterInternals(r).registration as any).snapshot;
  const expectedTerminals = 1 << count;

  if (snapshot.handlers.length !== 1 || snapshot.terminals.length !== expectedTerminals) {
    throw new Error(
      `optional shape regression: optionals=${count}, handlers=${snapshot.handlers.length}, terminals=${snapshot.terminals.length}`,
    );
  }
}

for (const count of [1, 5, 8, 10]) assertShape(count);

summary(() => {
  for (const count of [1, 5, 8, 10]) {
    bench(`build optional route (${count} optionals)`, () => {
      do_not_optimize(buildOptional(count));
    });
  }
});

summary(() => {
  const r = buildOptional(10);

  bench('match optional route (all absent)', () => {
    do_not_optimize(r.match('GET', '/x'));
  });

  bench('match optional route (all present)', () => {
    do_not_optimize(r.match('GET', '/x/a/b/c/d/e/f/g/h/i/j'));
  });
});

await run();
