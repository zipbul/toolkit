import { describe, expect, it, spyOn } from 'bun:test';
import * as zlib from 'node:zlib';

import { BUFFER_COMPRESSORS } from './compressors.ts';
import { Encoding } from './enums.ts';

describe('BUFFER_COMPRESSORS', () => {
  it('should call Bun.gzipSync with data and level when compressing with gzip', () => {
    const data = new Uint8Array([1, 2, 3]);
    const fakeResult = new Uint8Array([4, 5]);
    const spy = spyOn(Bun, 'gzipSync').mockReturnValue(fakeResult);

    const result = BUFFER_COMPRESSORS[Encoding.Gzip](data, 6);

    expect(spy).toHaveBeenCalledWith(data, { level: 6 });
    expect(result).toBe(fakeResult);
    spy.mockRestore();
  });

  it('should call node:zlib deflateSync with data and level when compressing with deflate', () => {
    const data = new Uint8Array([1, 2, 3]);
    const fakeResult = Buffer.from([4, 5]);
    const spy = spyOn(zlib, 'deflateSync').mockReturnValue(fakeResult);

    const result = BUFFER_COMPRESSORS[Encoding.Deflate](data, 6);

    expect(spy).toHaveBeenCalledWith(data, { level: 6 });
    expect(result).toEqual(fakeResult);
    spy.mockRestore();
  });

  it('should call brotliCompressSync with data and BROTLI_PARAM_QUALITY when compressing with brotli', () => {
    const data = new Uint8Array([1, 2, 3]);
    const level = 5;
    const fakeResult = Buffer.from([10, 20]);
    const spy = spyOn(zlib, 'brotliCompressSync').mockReturnValue(fakeResult);

    const result = BUFFER_COMPRESSORS[Encoding.Brotli](data, level);

    expect(spy).toHaveBeenCalledWith(data, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
    });
    expect(result).toEqual(fakeResult);
    spy.mockRestore();
  });

  it('should call Bun.zstdCompressSync with data and level when compressing with zstd', () => {
    const data = new Uint8Array([1, 2, 3]);
    const fakeResult = new Uint8Array([7, 8, 9]);
    const spy = spyOn(Bun, 'zstdCompressSync').mockReturnValue(fakeResult);

    const result = BUFFER_COMPRESSORS[Encoding.Zstd](data, 6);

    expect(spy).toHaveBeenCalledWith(data, { level: 6 });
    expect(result).toBe(fakeResult);
    spy.mockRestore();
  });

  it('should handle empty Uint8Array input when compressing', () => {
    const data = new Uint8Array(0);
    const fakeResult = new Uint8Array([]);
    const spy = spyOn(Bun, 'gzipSync').mockReturnValue(fakeResult);

    const result = BUFFER_COMPRESSORS[Encoding.Gzip](data, 6);

    expect(spy).toHaveBeenCalledWith(data, { level: 6 });
    expect(result).toBe(fakeResult);
    spy.mockRestore();
  });

  it('should produce same output for same input and level when called twice', () => {
    const data = new Uint8Array([1, 2, 3]);
    const fakeResult = new Uint8Array([4, 5, 6]);
    const spy = spyOn(Bun, 'gzipSync').mockReturnValue(fakeResult);

    const result1 = BUFFER_COMPRESSORS[Encoding.Gzip](data, 6);
    const result2 = BUFFER_COMPRESSORS[Encoding.Gzip](data, 6);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, data, { level: 6 });
    expect(spy).toHaveBeenNthCalledWith(2, data, { level: 6 });
    expect(result1).toBe(fakeResult);
    expect(result2).toBe(fakeResult);
    spy.mockRestore();
  });
});
