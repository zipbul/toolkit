import { HttpStatus } from '@zipbul/shared';

export const CORS_DEFAULT_METHODS: string[] = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
];

export const CORS_DEFAULT_OPTIONS_SUCCESS_STATUS = HttpStatus.NoContent;
