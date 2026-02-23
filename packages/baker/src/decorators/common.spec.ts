import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import {
  IsDefined, IsOptional, ValidateIf, ValidateNested,
  Equals, NotEquals, IsEmpty, IsNotEmpty, IsIn, IsNotIn,
} from './common';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsCommon {};
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

describe('common decorators — metadata collection', () => {
  // ── Flag decorators ──────────────────────────────────────────────────────

  it('@IsDefined sets flags.isDefined = true', () => {
    const Cls = makeClass();
    IsDefined()(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').flags.isDefined).toBe(true);
  });

  it('@IsOptional sets flags.isOptional = true', () => {
    const Cls = makeClass();
    IsOptional()(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').flags.isOptional).toBe(true);
  });

  it('@ValidateIf stores condition fn in flags.validateIf', () => {
    const Cls = makeClass();
    const cond = (obj: any) => obj.active;
    ValidateIf(cond)(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').flags.validateIf).toBe(cond);
  });

  it('@ValidateNested sets flags.validateNested = true', () => {
    const Cls = makeClass();
    ValidateNested()(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').flags.validateNested).toBe(true);
  });

  // ── Rule decorators ──────────────────────────────────────────────────────

  it('@Equals registers rule with ruleName "equals"', () => {
    const Cls = makeClass();
    Equals(42)(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('equals');
  });

  it('@NotEquals registers rule with ruleName "notEquals"', () => {
    const Cls = makeClass();
    NotEquals(0)(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('notEquals');
  });

  it('@IsEmpty registers rule with ruleName "isEmpty"', () => {
    const Cls = makeClass();
    IsEmpty()(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('isEmpty');
  });

  it('@IsNotEmpty registers rule with ruleName "isNotEmpty"', () => {
    const Cls = makeClass();
    IsNotEmpty()(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('isNotEmpty');
  });

  it('@IsIn registers rule with ruleName "isIn"', () => {
    const Cls = makeClass();
    IsIn(['a', 'b'])(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('isIn');
  });

  it('@IsNotIn registers rule with ruleName "isNotIn"', () => {
    const Cls = makeClass();
    IsNotIn(['x'])(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').validation[0].rule.ruleName).toBe('isNotIn');
  });

  // ── ValidationOptions forwarding ─────────────────────────────────────────

  it('@IsNotEmpty forwards each/groups/message/context to RuleDef', () => {
    const Cls = makeClass();
    const msg = 'must not be empty';
    const ctx = { hint: 'fill it in' };
    IsNotEmpty({ each: true, groups: ['admin'], message: msg, context: ctx })(Cls.prototype, 'field');
    const rd = getRaw(Cls, 'field').validation[0];
    expect(rd.each).toBe(true);
    expect(rd.groups).toEqual(['admin']);
    expect(rd.message).toBe(msg);
    expect(rd.context).toBe(ctx);
  });
});
