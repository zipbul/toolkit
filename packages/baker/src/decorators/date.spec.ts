import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import { MinDate, MaxDate } from './date';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsDate {};
  createdCtors.push(ctor);
  return ctor as any;
}

function getRaw(ctor: Function, key: string): any {
  return (ctor as any)[RAW]?.[key];
}

afterEach(() => {
  for (const ctor of createdCtors) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[RAW];
  }
  createdCtors.length = 0;
});

describe('date decorators — metadata collection', () => {
  it('@MinDate registers rule with ruleName "minDate"', () => {
    const Cls = makeClass();
    const d = new Date('2020-01-01');
    MinDate(d)(Cls.prototype, 'createdAt');
    expect(getRaw(Cls, 'createdAt').validation[0].rule.ruleName).toBe('minDate');
  });

  it('@MinDate rule passes for date >= min', () => {
    const Cls = makeClass();
    const min = new Date('2020-01-01');
    MinDate(min)(Cls.prototype, 'createdAt');
    const rule = getRaw(Cls, 'createdAt').validation[0].rule;
    expect(rule(new Date('2021-01-01'))).toBe(true);
    expect(rule(new Date('2019-12-31'))).toBe(false);
  });

  it('@MaxDate registers rule with ruleName "maxDate"', () => {
    const Cls = makeClass();
    const d = new Date('2030-12-31');
    MaxDate(d)(Cls.prototype, 'expiresAt');
    expect(getRaw(Cls, 'expiresAt').validation[0].rule.ruleName).toBe('maxDate');
  });

  it('@MaxDate rule passes for date <= max', () => {
    const Cls = makeClass();
    const max = new Date('2030-12-31');
    MaxDate(max)(Cls.prototype, 'expiresAt');
    const rule = getRaw(Cls, 'expiresAt').validation[0].rule;
    expect(rule(new Date('2025-01-01'))).toBe(true);
    expect(rule(new Date('2031-01-01'))).toBe(false);
  });

  it('@MinDate forwards groups option', () => {
    const Cls = makeClass();
    MinDate(new Date(), { groups: ['admin'] })(Cls.prototype, 'dt');
    expect(getRaw(Cls, 'dt').validation[0].groups).toEqual(['admin']);
  });
});
