import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import { IsNotEmptyObject, IsInstance } from './object';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsObject {};
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

describe('object decorators — metadata collection', () => {
  it('@IsNotEmptyObject registers rule with ruleName "isNotEmptyObject"', () => {
    const Cls = makeClass();
    IsNotEmptyObject()(Cls.prototype, 'meta');
    expect(getRaw(Cls, 'meta').validation[0].rule.ruleName).toBe('isNotEmptyObject');
  });

  it('@IsNotEmptyObject rule passes for non-empty object', () => {
    const Cls = makeClass();
    IsNotEmptyObject()(Cls.prototype, 'meta');
    const rule = getRaw(Cls, 'meta').validation[0].rule;
    expect(rule({ a: 1 })).toBe(true);
    expect(rule({})).toBe(false);
  });

  it('@IsNotEmptyObject with nullable:true ignores null-valued keys', () => {
    const Cls = makeClass();
    IsNotEmptyObject({ nullable: true })(Cls.prototype, 'meta');
    const rule = getRaw(Cls, 'meta').validation[0].rule;
    expect(rule({ a: null, b: null })).toBe(false);
    expect(rule({ a: 1 })).toBe(true);
  });

  it('@IsInstance registers rule with ruleName "isInstance"', () => {
    const Cls = makeClass();
    IsInstance(Date)(Cls.prototype, 'dt');
    expect(getRaw(Cls, 'dt').validation[0].rule.ruleName).toBe('isInstance');
  });

  it('@IsInstance rule passes for correct instance', () => {
    const Cls = makeClass();
    IsInstance(Date)(Cls.prototype, 'dt');
    const rule = getRaw(Cls, 'dt').validation[0].rule;
    expect(rule(new Date())).toBe(true);
    expect(rule('not a date')).toBe(false);
  });

  it('@IsNotEmptyObject forwards context option', () => {
    const Cls = makeClass();
    const ctx = { reason: 'must have keys' };
    IsNotEmptyObject(undefined, { context: ctx })(Cls.prototype, 'obj');
    expect(getRaw(Cls, 'obj').validation[0].context).toBe(ctx);
  });
});
