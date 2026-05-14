/* eslint-disable no-console */
import { Router } from '../src/router';

// Smaller build (1000 routes), bigger match phase so build is negligible
const r = new Router<number>();
for (let i = 0; i < 1000; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();

const path = `/r500/u/42/p/7`;
// 500M iterations — match should be 99%+ of profile
for (let i = 0; i < 500_000_000; i++) r.match('GET', path);
