import { Router } from '../index';
import { getRouterInternals } from '../internal';

const router = new Router();
const count = 50000;

console.log('Adding ' + count + ' routes...');
for (let i = 0; i < count; i++) {
  router.add('GET', '/u' + i + '/:id', i);
}

const mem = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
console.log('Heap before build: ' + mem() + ' MB');

router.build();

if (globalThis.Bun) Bun.gc(true);
console.log('Heap after build & GC: ' + mem() + ' MB');

const internals = getRouterInternals(router);
console.log('PendingRoutes length: ' + (internals.registration as any).pendingRoutes.length);

const factories = internals.registration.snapshot!.paramsFactories;
const uniqueFactories = new Set(factories.filter(f => f !== null)).size;
console.log('Unique factories created: ' + uniqueFactories);
// `terminalHandlers` array is build-time state and not retained on the
// snapshot; the published slab carries `terminalSlab: Int32Array` with
// three slots per terminal (handler, isWildcard, presentBitmask), so
// the terminal count is `length / 3`.
console.log('Terminals: ' + (internals.registration.snapshot!.terminalSlab.length / 3));
