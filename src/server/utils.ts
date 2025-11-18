// Regex patterns for path matching (defined at top level for performance)
export const APP_TILDE_PATH_REGEX = /^\/app\/~/;
export const TILDE_PATH_REGEX = /^\/~/;
export const APP_PATH_REGEX = /^\/app\//;
export const LEADING_SLASH_REGEX = /^\//;

export const createRedirectResponse = (location: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
    },
  });
