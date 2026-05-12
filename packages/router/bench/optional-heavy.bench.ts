import { bench, do_not_optimize, run, summary } from 'mitata';

import { Router } from '../src/router';

// One optional parameter is the shape every realistic route uses
// (`/users/:id?`, `/docs/:section?`, etc). Adding more `:p?` segments
// in a row produces variants like `/x/:p0` vs `/x/:p1` that collide on
// the same segment-tree node — the router rejects them with
// `route-conflict` / `param-duplicate`, so the earlier "/x/:p0?/:p1?…"
// fixture never built. Stick to the single-optional shape that
// actually exercises the optional-expansion path the matcher cares
// about.
function buildOneOptional(): Router<string> {
  const r = new Router<string>();
  r.add('GET', '/x/:id?', 'handler');
  r.build();
  return r;
}

summary(() => {
  bench('build /x/:id?', () => {
    do_not_optimize(buildOneOptional());
  });
});

summary(() => {
  const r = buildOneOptional();
  bench('match /x (absent)', () => {
    do_not_optimize(r.match('GET', '/x'));
  });
  bench('match /x/42 (present)', () => {
    do_not_optimize(r.match('GET', '/x/42'));
  });
});

await run();
