import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import { Min, Max, IsPositive, IsNegative, IsDivisibleBy } from './number';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsNumber {};
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

describe('number decorators — metadata collection', () => {
  it('@Min registers rule with ruleName "min"', () => {
    const Cls = makeClass();
    Min(0)(Cls.prototype, 'value');
    expect(getRaw(Cls, 'value').validation[0].rule.ruleName).toBe('min');
  });

  it('@Min rule passes for value >= min', () => {
    const Cls = makeClass();
    Min(5)(Cls.prototype, 'value');
    const rule = getRaw(Cls, 'value').validation[0].rule;
    expect(rule(5)).toBe(true);
    expect(rule(10)).toBe(true);
    expect(rule(4)).toBe(false);
  });

  it('@Max registers rule with ruleName "max"', () => {
    const Cls = makeClass();
    Max(100)(Cls.prototype, 'score');
    expect(getRaw(Cls, 'score').validation[0].rule.ruleName).toBe('max');
  });

  it('@Max rule passes for value <= max', () => {
    const Cls = makeClass();
    Max(10)(Cls.prototype, 'value');
    const rule = getRaw(Cls, 'value').validation[0].rule;
    expect(rule(10)).toBe(true);
    expect(rule(9)).toBe(true);
    expect(rule(11)).toBe(false);
  });

  it('@IsPositive registers rule with ruleName "isPositive"', () => {
    const Cls = makeClass();
    IsPositive()(Cls.prototype, 'count');
    expect(getRaw(Cls, 'count').validation[0].rule.ruleName).toBe('isPositive');
  });

  it('@IsNegative registers rule with ruleName "isNegative"', () => {
    const Cls = makeClass();
    IsNegative()(Cls.prototype, 'diff');
    expect(getRaw(Cls, 'diff').validation[0].rule.ruleName).toBe('isNegative');
  });

  it('@IsDivisibleBy registers rule with ruleName "isDivisibleBy"', () => {
    const Cls = makeClass();
    IsDivisibleBy(3)(Cls.prototype, 'n');
    expect(getRaw(Cls, 'n').validation[0].rule.ruleName).toBe('isDivisibleBy');
  });

  it('@Min forwards groups option', () => {
    const Cls = makeClass();
    Min(0, { groups: ['public'] })(Cls.prototype, 'value');
    expect(getRaw(Cls, 'value').validation[0].groups).toEqual(['public']);
  });
});
