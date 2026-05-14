/* eslint-disable no-console */
import { Router } from '../src/router';

const r = new Router<number>();
for (let i = 0; i < 100_000; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();

// 60M dynamic-path matches — heavy sampling target
const path = `/r50000/u/42/p/7`;
for (let i = 0; i < 60_000_000; i++) r.match('GET', path);
