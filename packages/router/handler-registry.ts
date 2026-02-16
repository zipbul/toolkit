import type { MatchResult } from '../types';
import type { Handler } from './types';

export class HandlerRegistry<R = MatchResult> {
  private handlers: Map<string, Handler<R>>;

  constructor() {
    this.handlers = new Map();
  }

  register(id: string, handler: Handler<R>): void {
    if (this.handlers.has(id)) {
      throw new Error(`Handler ID '${id}' is already registered.`);
    }

    this.handlers.set(id, handler);
  }

  get(id: string): Handler<R> | undefined {
    return this.handlers.get(id);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  clear(): void {
    this.handlers.clear();
  }
}
