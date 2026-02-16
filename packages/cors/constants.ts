import { HttpMethod } from '../../enums';

export const CORS_DEFAULT_METHODS: HttpMethod[] = [
  HttpMethod.Get,
  HttpMethod.Head,
  HttpMethod.Put,
  HttpMethod.Patch,
  HttpMethod.Post,
  HttpMethod.Delete,
];
export const CORS_DEFAULT_OPTIONS_SUCCESS_STATUS = 204;
