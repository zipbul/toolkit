/* eslint-disable no-console */
import { Router } from '../src/router';

function gc(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }

const before = rssMb();
const r = new Router<number>();
for (let i = 0; i < 100_000; i++) r.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
r.build();
console.log(`build done — rss=${rssMb().toFixed(1)}MB (delta=${(rssMb() - before).toFixed(1)}MB)`);

await new Promise((res) => setTimeout(res, 100));
console.log(`+100ms  — rss=${rssMb().toFixed(1)}MB`);
await new Promise((res) => setTimeout(res, 300));
console.log(`+400ms  — rss=${rssMb().toFixed(1)}MB`);
await new Promise((res) => setTimeout(res, 600));
console.log(`+1000ms — rss=${rssMb().toFixed(1)}MB`);
await new Promise((res) => setTimeout(res, 2000));
console.log(`+3000ms — rss=${rssMb().toFixed(1)}MB`);
