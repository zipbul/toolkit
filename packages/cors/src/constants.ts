import { HttpMethod, HttpStatus } from '@zipbul/shared';

export const CORS_DEFAULT_METHODS: string[] = [
  HttpMethod.Get,
  HttpMethod.Head,
  HttpMethod.Put,
  HttpMethod.Patch,
  HttpMethod.Post,
  HttpMethod.Delete,
];

export const CORS_DEFAULT_OPTIONS_SUCCESS_STATUS = HttpStatus.NoContent;
