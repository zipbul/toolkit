import type { DecoderFn } from '../types';

export const decoder: DecoderFn = (raw: string): string => {
  if (!raw.includes('%')) {
    return raw;
  }
  return decodeURIComponent(raw);
};
