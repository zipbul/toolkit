import { Algorithm } from './enums';

export const DEFAULT_ALGORITHM = Algorithm.SlidingWindow;
export const DEFAULT_COST = 1;
export const DEFAULT_CLOCK = Date.now;
const noop = () => {};
export const DEFAULT_HOOKS = { onConsume: noop, onLimit: noop } as const;
