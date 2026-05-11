/**
 * Options for {@link sanitizeFilename}.
 */
export interface SanitizeFilenameOptions {
  /**
   * Maximum length of the sanitized filename (including extension).
   * @defaultValue `255`
   */
  maxLength?: number;
  /**
   * Character to replace unsafe characters with.
   * @defaultValue `'_'`
   */
  replacement?: string;
}

/** Characters that are unsafe in filenames across Windows, macOS, and Linux. */
const UNSAFE_RE = /[<>:"/\\|?*\x00-\x1f]/g;

/** Reserved filenames on Windows (case-insensitive). */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Sanitizes a user-provided filename for safe filesystem use.
 *
 * - Strips directory components (path traversal prevention)
 * - Removes null bytes and control characters
 * - Replaces unsafe special characters (`<>:"/\\|?*`)
 * - Rejects `.` and `..`
 * - Removes leading dots (hidden files)
 * - Rejects Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 * - Enforces maximum filename length
 * - Returns `undefined` for empty/invalid filenames (let the caller decide a fallback)
 *
 * @example
 * ```ts
 * sanitizeFilename('../../etc/passwd')     // 'passwd'
 * sanitizeFilename('C:\\Users\\file.txt')  // 'file.txt'
 * sanitizeFilename('photo<1>.jpg')         // 'photo_1_.jpg'
 * sanitizeFilename('.hidden')              // 'hidden'
 * sanitizeFilename('')                     // undefined
 * sanitizeFilename('...')                  // undefined
 * ```
 */
export function sanitizeFilename(
  filename: string,
  options?: SanitizeFilenameOptions,
): string | undefined {
  const maxLength = options?.maxLength ?? 255;
  const replacement = options?.replacement ?? '_';

  // 1. Strip directory components (both / and \)
  let result = filename;
  const lastSlash = Math.max(result.lastIndexOf('/'), result.lastIndexOf('\\'));

  if (lastSlash !== -1) {
    result = result.slice(lastSlash + 1);
  }

  // 2. Remove null bytes and replace unsafe characters
  result = result.replace(UNSAFE_RE, replacement);

  // 3. Remove leading dots (prevent hidden files on Unix)
  result = result.replace(/^\.+/, '');

  // 4. Trim whitespace and dots from both ends (Windows doesn't allow trailing dots/spaces)
  result = result.replace(/^[\s.]+|[\s.]+$/g, '');

  // 5. Check for empty result
  if (result.length === 0) {
    return undefined;
  }

  // 6. Check for Windows reserved names
  const nameWithoutExt = result.includes('.') ? result.slice(0, result.indexOf('.')) : result;

  if (WINDOWS_RESERVED_RE.test(nameWithoutExt)) {
    return undefined;
  }

  // 7. Enforce maximum length
  if (result.length > maxLength) {
    // Try to preserve the extension
    const dotIdx = result.lastIndexOf('.');

    if (dotIdx !== -1 && result.length - dotIdx <= 20) {
      const ext = result.slice(dotIdx);
      const nameLen = maxLength - ext.length;

      if (nameLen > 0) {
        result = result.slice(0, nameLen) + ext;
      } else {
        result = result.slice(0, maxLength);
      }
    } else {
      result = result.slice(0, maxLength);
    }
  }

  return result;
}
