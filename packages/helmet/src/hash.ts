/**
 * Compute a base64 SRI hash of the given content using Web Crypto.
 *
 * @example
 *   const hash = await hashFromString(scriptText, 'sha384');
 *   Csp.hash('sha384', hash);
 */
export async function hashFromString(
  input: string | ArrayBuffer | Uint8Array,
  algo: 'sha256' | 'sha384' | 'sha512' = 'sha384',
): Promise<string> {
  let buf: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    buf = new TextEncoder().encode(input) as Uint8Array<ArrayBuffer>;
  } else if (input instanceof Uint8Array) {
    const ab = new ArrayBuffer(input.byteLength);
    new Uint8Array(ab).set(input);
    buf = new Uint8Array(ab);
  } else {
    buf = new Uint8Array(input);
  }
  const map: Record<typeof algo, string> = {
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
  };
  const digest = await crypto.subtle.digest(map[algo], buf);
  return arrayBufferToBase64(digest);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
