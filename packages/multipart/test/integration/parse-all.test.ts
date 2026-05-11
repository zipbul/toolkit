import { describe, test, expect } from 'bun:test';

import { Multipart } from '../../src/multipart';

// ── Helpers ─────────────────────────────────────────────────────────

function createRequest(boundary: string, body: string | Uint8Array): Request {
  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

function buildBody(boundary: string, parts: Array<{ headers: string; body: string }>): string {
  let raw = '';

  for (const part of parts) {
    raw += `--${boundary}\r\n${part.headers}\r\n\r\n${part.body}\r\n`;
  }

  raw += `--${boundary}--\r\n`;

  return raw;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Multipart.parseAll — integration', () => {
  const mp = Multipart.create();

  test('collects fields and files separately', async () => {
    const boundary = 'parseall-mixed';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="username"', body: 'alice' },
      {
        headers:
          'Content-Disposition: form-data; name="avatar"; filename="pic.png"\r\nContent-Type: image/png',
        body: 'PNG_DATA',
      },
      { headers: 'Content-Disposition: form-data; name="bio"', body: 'Hello there' },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(2);
    expect(files.size).toBe(1);

    expect(fields.get('username')).toEqual(['alice']);
    expect(fields.get('bio')).toEqual(['Hello there']);

    const avatarFiles = files.get('avatar')!;

    expect(avatarFiles).toHaveLength(1);
    expect(avatarFiles[0]!.filename).toBe('pic.png');
    expect(await avatarFiles[0]!.text()).toBe('PNG_DATA');
  });

  test('returns empty maps when no parts', async () => {
    const boundary = 'parseall-empty';
    const body = `--${boundary}--\r\n`;

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(0);
    expect(files.size).toBe(0);
  });

  test('only fields, no files', async () => {
    const boundary = 'parseall-fields-only';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="name"', body: 'Alice' },
      { headers: 'Content-Disposition: form-data; name="age"', body: '30' },
      { headers: 'Content-Disposition: form-data; name="city"', body: 'Seoul' },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(3);
    expect(files.size).toBe(0);

    expect(fields.get('name')).toEqual(['Alice']);
    expect(fields.get('age')).toEqual(['30']);
    expect(fields.get('city')).toEqual(['Seoul']);
  });

  test('only files, no fields', async () => {
    const boundary = 'parseall-files-only';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="doc1"; filename="a.pdf"\r\nContent-Type: application/pdf',
        body: 'pdf content a',
      },
      {
        headers:
          'Content-Disposition: form-data; name="doc2"; filename="b.pdf"\r\nContent-Type: application/pdf',
        body: 'pdf content b',
      },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(0);
    expect(files.size).toBe(2);

    expect(files.get('doc1')![0]!.filename).toBe('a.pdf');
    expect(await files.get('doc1')![0]!.text()).toBe('pdf content a');
    expect(files.get('doc2')![0]!.filename).toBe('b.pdf');
    expect(await files.get('doc2')![0]!.text()).toBe('pdf content b');
  });

  test('duplicate field names produce arrays', async () => {
    const boundary = 'parseall-dup-fields';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="tag"', body: 'javascript' },
      { headers: 'Content-Disposition: form-data; name="tag"', body: 'typescript' },
      { headers: 'Content-Disposition: form-data; name="tag"', body: 'bun' },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(1);
    expect(files.size).toBe(0);

    const tags = fields.get('tag')!;

    expect(tags).toHaveLength(3);
    expect(tags).toEqual(['javascript', 'typescript', 'bun']);
  });

  test('multiple files with same name produce arrays', async () => {
    const boundary = 'parseall-dup-files';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="photos"; filename="img1.jpg"\r\nContent-Type: image/jpeg',
        body: 'jpeg1',
      },
      {
        headers:
          'Content-Disposition: form-data; name="photos"; filename="img2.jpg"\r\nContent-Type: image/jpeg',
        body: 'jpeg2',
      },
      {
        headers:
          'Content-Disposition: form-data; name="photos"; filename="img3.jpg"\r\nContent-Type: image/jpeg',
        body: 'jpeg3',
      },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(0);
    expect(files.size).toBe(1);

    const photos = files.get('photos')!;

    expect(photos).toHaveLength(3);
    expect(photos[0]!.filename).toBe('img1.jpg');
    expect(photos[1]!.filename).toBe('img2.jpg');
    expect(photos[2]!.filename).toBe('img3.jpg');
    expect(await photos[0]!.text()).toBe('jpeg1');
    expect(await photos[1]!.text()).toBe('jpeg2');
    expect(await photos[2]!.text()).toBe('jpeg3');
  });

  test('mixed single and duplicate names', async () => {
    const boundary = 'parseall-mixed-dup';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="title"', body: 'My Album' },
      { headers: 'Content-Disposition: form-data; name="tag"', body: 'travel' },
      { headers: 'Content-Disposition: form-data; name="tag"', body: 'summer' },
      {
        headers:
          'Content-Disposition: form-data; name="cover"; filename="cover.jpg"\r\nContent-Type: image/jpeg',
        body: 'cover data',
      },
      {
        headers:
          'Content-Disposition: form-data; name="photos"; filename="p1.jpg"\r\nContent-Type: image/jpeg',
        body: 'photo 1',
      },
      {
        headers:
          'Content-Disposition: form-data; name="photos"; filename="p2.jpg"\r\nContent-Type: image/jpeg',
        body: 'photo 2',
      },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(2);
    expect(fields.get('title')).toEqual(['My Album']);
    expect(fields.get('tag')).toEqual(['travel', 'summer']);

    expect(files.size).toBe(2);
    expect(files.get('cover')).toHaveLength(1);
    expect(files.get('photos')).toHaveLength(2);
    expect(files.get('photos')![0]!.filename).toBe('p1.jpg');
    expect(files.get('photos')![1]!.filename).toBe('p2.jpg');
  });

  test('large number of parts (20 fields + 5 files)', async () => {
    const boundary = 'parseall-large';
    const rawParts: Array<{ headers: string; body: string }> = [];

    for (let i = 0; i < 20; i++) {
      rawParts.push({
        headers: `Content-Disposition: form-data; name="field_${i}"`,
        body: `value_${i}`,
      });
    }

    for (let i = 0; i < 5; i++) {
      rawParts.push({
        headers: `Content-Disposition: form-data; name="file_${i}"; filename="f${i}.txt"\r\nContent-Type: text/plain`,
        body: `file content ${i}`,
      });
    }

    const body = buildBody(boundary, rawParts);
    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(20);
    expect(files.size).toBe(5);

    for (let i = 0; i < 20; i++) {
      expect(fields.get(`field_${i}`)).toEqual([`value_${i}`]);
    }

    for (let i = 0; i < 5; i++) {
      const fileArr = files.get(`file_${i}`)!;

      expect(fileArr).toHaveLength(1);
      expect(fileArr[0]!.filename).toBe(`f${i}.txt`);
      expect(await fileArr[0]!.text()).toBe(`file content ${i}`);
    }
  });
});
