/** 10 MiB */
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

export const DEFAULT_MAX_FILES = 10;

/** 1 MiB */
export const DEFAULT_MAX_FIELD_SIZE = 1 * 1024 * 1024;

export const DEFAULT_MAX_FIELDS = 100;

/** 8 KiB */
export const DEFAULT_MAX_HEADER_SIZE = 8 * 1024;

/** 50 MiB */
export const DEFAULT_MAX_TOTAL_SIZE: number | null = 50 * 1024 * 1024;

/** \r\n */
export const CRLF = Buffer.from('\r\n');

/** \r\n\r\n — separates headers from body within a part. */
export const CRLFCRLF = Buffer.from('\r\n\r\n');

/** Default max total parts (fields + files). Infinity = no limit. */
export const DEFAULT_MAX_PARTS: number = Infinity;

/** Reusable zero-length buffer to avoid repeated allocations. */
export const EMPTY_BUF: Buffer = Buffer.alloc(0);
