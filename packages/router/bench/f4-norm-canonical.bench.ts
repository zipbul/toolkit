/**
 * F4: dead-branch normalization on canonical input.
 *
 * Current (post-pre-peek miss):
 *   - emitQueryStrip:  var qi = path.indexOf('?'); var sp = qi < 0 ? path : path.substring(0, qi);
 *   - emitTrailingSlashTrim: charCodeAt last + slice
 *   - emitLowerCase: maybe
 *
 * On canonical input, all branches are false but their predicates run.
 *
 * Variants:
 *   A: full normalize (current)
 *   B: skip-when-canonical (single fast-path: if no '?' and not ending in '/' and lowercase, sp=path)
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const PATH = '/api/v1/users/42';
const trimSlash = true; // matches default 'ignore'
const lowerCase = false;

function variantA(path: string): string | null {
  // emitQueryStrip
  const qi = path.indexOf('?');
  let sp = qi < 0 ? path : path.substring(0, qi);
  // emitTrailingSlashTrim
  if (trimSlash && sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) {
    sp = sp.substring(0, sp.length - 1);
  }
  // emitLowerCase (skipped when lowerCase=false, but the branch exists at codegen-time only)
  if (lowerCase) {
    sp = sp.toLowerCase();
  }
  return sp;
}

function variantB(path: string): string | null {
  // Fast canonical detection: no '?' AND no trailing slash AND no upper.
  // For the bench we assume it's already lowercase.
  const last = path.charCodeAt(path.length - 1);
  if (path.indexOf('?') < 0 && (last !== 47 || path.length === 1)) {
    return path; // canonical: zero-copy
  }
  // fall-through to full normalize
  return variantA(path);
}

summary(() => {
  bench('F4 canonical input: A full normalize', () => {
    do_not_optimize(variantA(PATH));
  });
  bench('F4 canonical input: B skip-when-canonical', () => {
    do_not_optimize(variantB(PATH));
  });
});

const PATH_QUERY = '/api/v1/users/42?x=1';
summary(() => {
  bench('F4 query input: A full normalize', () => {
    do_not_optimize(variantA(PATH_QUERY));
  });
  bench('F4 query input: B skip-when-canonical', () => {
    do_not_optimize(variantB(PATH_QUERY));
  });
});

const PATH_TRAIL = '/api/v1/users/42/';
summary(() => {
  bench('F4 trailing input: A full normalize', () => {
    do_not_optimize(variantA(PATH_TRAIL));
  });
  bench('F4 trailing input: B skip-when-canonical', () => {
    do_not_optimize(variantB(PATH_TRAIL));
  });
});

await run();
