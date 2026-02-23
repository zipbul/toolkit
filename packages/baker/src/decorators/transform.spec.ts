import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import { Expose, Exclude, Transform, Type } from './transform';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsTransform {};
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

describe('transform decorators — metadata collection', () => {
  // ── @Expose ──────────────────────────────────────────────────────────────

  it('@Expose() registers empty ExposeDef', () => {
    const Cls = makeClass();
    Expose()(Cls.prototype, 'name');
    expect(getRaw(Cls, 'name').expose).toHaveLength(1);
    expect(getRaw(Cls, 'name').expose[0]).toEqual({});
  });

  it('@Expose({ name }) stores name in expose stack', () => {
    const Cls = makeClass();
    Expose({ name: 'full_name' })(Cls.prototype, 'name');
    expect(getRaw(Cls, 'name').expose[0].name).toBe('full_name');
  });

  it('@Expose stacks multiple entries', () => {
    const Cls = makeClass();
    Expose({ name: 'a', deserializeOnly: true })(Cls.prototype, 'field');
    Expose({ name: 'b', serializeOnly: true })(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').expose).toHaveLength(2);
  });

  it('@Expose({ deserializeOnly: true }) stored in expose', () => {
    const Cls = makeClass();
    Expose({ deserializeOnly: true })(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').expose[0].deserializeOnly).toBe(true);
  });

  it('@Expose({ groups }) stored in expose', () => {
    const Cls = makeClass();
    Expose({ groups: ['public'] })(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').expose[0].groups).toEqual(['public']);
  });

  // ── @Exclude ─────────────────────────────────────────────────────────────

  it('@Exclude() sets exclude to {}', () => {
    const Cls = makeClass();
    Exclude()(Cls.prototype, 'secret');
    expect(getRaw(Cls, 'secret').exclude).toEqual({});
  });

  it('@Exclude({ serializeOnly: true }) stored correctly', () => {
    const Cls = makeClass();
    Exclude({ serializeOnly: true })(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').exclude?.serializeOnly).toBe(true);
  });

  it('@Exclude({ deserializeOnly: true }) stored correctly', () => {
    const Cls = makeClass();
    Exclude({ deserializeOnly: true })(Cls.prototype, 'field');
    expect(getRaw(Cls, 'field').exclude?.deserializeOnly).toBe(true);
  });

  // ── @Transform ────────────────────────────────────────────────────────────

  it('@Transform stores fn in transform stack', () => {
    const Cls = makeClass();
    const fn = ({ value }: any) => value;
    Transform(fn)(Cls.prototype, 'name');
    expect(getRaw(Cls, 'name').transform[0].fn).toBe(fn);
  });

  it('@Transform({ deserializeOnly }) stores option', () => {
    const Cls = makeClass();
    const fn = ({ value }: any) => value;
    Transform(fn, { deserializeOnly: true })(Cls.prototype, 'name');
    expect(getRaw(Cls, 'name').transform[0].options?.deserializeOnly).toBe(true);
  });

  it('@Transform stacks multiple transforms', () => {
    const Cls = makeClass();
    const fn1 = ({ value }: any) => String(value).trim();
    const fn2 = ({ value }: any) => String(value).toLowerCase();
    Transform(fn1)(Cls.prototype, 'email');
    Transform(fn2)(Cls.prototype, 'email');
    expect(getRaw(Cls, 'email').transform).toHaveLength(2);
  });

  // ── @Type ─────────────────────────────────────────────────────────────────

  it('@Type stores fn in meta.type', () => {
    const Cls = makeClass();
    class NestedDto {}
    Type(() => NestedDto)(Cls.prototype, 'child');
    expect(getRaw(Cls, 'child').type).not.toBeNull();
    expect(getRaw(Cls, 'child').type.fn()).toBe(NestedDto);
  });

  it('@Type with discriminator stores discriminator config', () => {
    const Cls = makeClass();
    class DogDto {}
    class CatDto {}
    Type(() => DogDto, {
      discriminator: {
        property: 'breed',
        subTypes: [
          { value: DogDto, name: 'dog' },
          { value: CatDto, name: 'cat' },
        ],
      },
    })(Cls.prototype, 'animal');
    const typeDef = getRaw(Cls, 'animal').type;
    expect(typeDef.discriminator.property).toBe('breed');
    expect(typeDef.discriminator.subTypes).toHaveLength(2);
  });
});
