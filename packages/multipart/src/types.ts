import type { AllowedMimeTypes, MultipartFile, MultipartOptions } from './interfaces';

/**
 * Fully resolved multipart options with all defaults applied.
 */
export type ResolvedMultipartOptions = Required<Omit<MultipartOptions, 'allowedMimeTypes'>> & {
  allowedMimeTypes: AllowedMimeTypes | undefined;
};

/**
 * Result of {@link Multipart.parseAll}, collecting all parts into fields and files.
 *
 * Both Maps use arrays as values to support multiple parts with the same name,
 * e.g. `<input type="file" name="docs" multiple>`.
 */
export type ParseAllResult = {
  fields: Map<string, string[]>;
  files: Map<string, MultipartFile[]>;
};
