export enum CorsAction {
  Continue         = 'Continue',
  RespondPreflight = 'RespondPreflight',
  Reject           = 'Reject',
}

export enum CorsRejectionReason {
  NoOrigin         = 'NoOrigin',
  OriginNotAllowed = 'OriginNotAllowed',
  MethodNotAllowed = 'MethodNotAllowed',
  HeaderNotAllowed = 'HeaderNotAllowed',
}
