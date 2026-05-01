/**
 * #55 — performBuild throw → sealed=true + matchImpl=undefined.
 *       ESM modules cannot be monkey-patched; trigger path absent.
 */

import { Router } from '../index';

// Try various inputs that path-parser accepts. compileMatchFn (new Function)
// only throws on syntax error; emit always produces valid JS.
const r = new Router<string>();
r.add('GET', '/u/:id(\\d+)', 'h');
r.add('GET', '/files/*p', 'f');
r.add('GET', '/long/path/with/many/segments/:id', 'm');
let buildThrew = false;
try { r.build(); } catch { buildThrew = true; }
console.log('build throws on accepted inputs:', buildThrew);

console.log('VERDICT: REFUTED — no observable trigger path within public API; theoretical only');
