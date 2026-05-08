/**
 * F10: simplifiable normalize branch — `if (sp !== path)` second-lookup.
 *
 * Current static-only single-method emitter (emitter.ts:131-137):
 *   ...normalize sp from path...
 *   if (sp !== path) {
 *     out = activeBucket[sp];
 *     if (out !== undefined) return out;
 *   }
 *   return null;
 *
 * Variant B: build-time decision — when trimSlash=false && lowerCase=false,
 * emit a simplified form that only does query-strip and one bucket lookup.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

const BUCKET = (() => {
  const o = new NullProtoObj();
  o['/api/v1/users'] = { value: 'A', params: {} };
  o['/api/v1/posts'] = { value: 'B', params: {} };
  return o;
})();

const PATH = '/api/v1/users';

// Variant A: full path includes trim+lower (with trimSlash=true), then sp!==path branch.
function variantA(path: string): unknown {
  // pre-peek
  let pre = BUCKET[path];
  if (pre !== undefined) return pre;
  // query strip
  const qi = path.indexOf('?');
  let sp = qi < 0 ? path : path.substring(0, qi);
  // trailing slash trim
  if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) {
    sp = sp.substring(0, sp.length - 1);
  }
  if (sp !== path) {
    pre = BUCKET[sp];
    if (pre !== undefined) return pre;
  }
  return null;
}

// Variant B: simplified — trimSlash=false && lowerCase=false. Single canonical lookup.
function variantB(path: string): unknown {
  const pre = BUCKET[path];
  if (pre !== undefined) return pre;
  const qi = path.indexOf('?');
  if (qi < 0) return null;
  const sp = path.substring(0, qi);
  const out = BUCKET[sp];
  if (out !== undefined) return out;
  return null;
}

summary(() => {
  bench('F10 canonical: A full normalize + sp!==path', () => {
    do_not_optimize(variantA(PATH));
  });
  bench('F10 canonical: B simplified', () => {
    do_not_optimize(variantB(PATH));
  });
});

const PATH_TRAIL = '/api/v1/users/';
summary(() => {
  bench('F10 trailing: A full normalize + sp!==path', () => {
    do_not_optimize(variantA(PATH_TRAIL));
  });
  bench('F10 trailing: B simplified (would miss trim)', () => {
    do_not_optimize(variantB(PATH_TRAIL));
  });
});

await run();
