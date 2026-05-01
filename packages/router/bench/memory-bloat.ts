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
console.log('TerminalHandlers length: ' + internals.registration.snapshot!.terminalHandlers.length);
