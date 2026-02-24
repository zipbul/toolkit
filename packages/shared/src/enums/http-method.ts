/**
 * HTTP method token.
 * 표준 7개 메서드에 대해 autocomplete을 제공하면서 커스텀 메서드(WebDAV 등)도 허용.
 */
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | (string & {});
