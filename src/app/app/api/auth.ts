import { Effect } from "effect";
import { CacheKeys, clearCache, getCached, setCached } from "~/lib/cache";

/**
 * Gets CSRF token from cookies.
 */
export const getCsrfTokenFromCookie = (): string | null => {
  const cookies = document.cookie.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name === "csrf-token" && valueParts.length > 0) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return null;
};

/**
 * Fetches a new CSRF token from the server.
 */
export const refreshCsrfToken = (): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const response: Response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/csrf-token", {
          method: "GET",
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to fetch CSRF token: ${error}`),
    });

    if (!response.ok) {
      return yield* Effect.fail(new Error("Failed to refresh CSRF token"));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ csrfToken: string }>,
      catch: (error) =>
        new Error(`Failed to parse CSRF token response: ${error}`),
    });

    return data.csrfToken;
  });

/**
 * Handles authentication errors (401) by redirecting to login.
 */
export const handleAuthError = (response: Response): void => {
  if (response.status === 401) {
    window.location.href = "/login";
  }
};

/**
 * Handles CSRF errors (403) by refreshing the token and retrying the request.
 * Returns the retried response.
 */
export const handleCsrfError = (
  response: Response,
  retryFn: (csrfToken: string) => Effect.Effect<Response, Error>
): Effect.Effect<Response, Error> =>
  Effect.gen(function* () {
    if (response.status !== 403) {
      return yield* Effect.fail(
        new Error(`Unexpected status: ${response.status}`)
      );
    }

    console.log("[CSRF] Token expired, refreshing and retrying...");

    // Refresh CSRF token
    const newCsrfToken = yield* refreshCsrfToken();

    // Retry the request with the new token
    const retryResponse = yield* retryFn(newCsrfToken);

    if (retryResponse.ok) {
      console.log("[CSRF] Retry succeeded");
    } else {
      console.error("[CSRF] Retry failed:", retryResponse.status);
    }

    return retryResponse;
  });

export const getCurrentUser = Effect.gen(function* () {
  if (!navigator.onLine) {
    return yield* Effect.fail(new Error("Cannot get user while offline"));
  }

  // Check cache first (long TTL for user)
  const cached = yield* getCached<{
    id: string;
    email: string;
    createdAt: string;
  }>(CacheKeys.user);
  if (cached !== null) {
    return cached;
  }

  const response: Response = yield* Effect.tryPromise({
    try: () => fetch("/api/auth/me", { credentials: "include" }),
    catch: (error) => new Error(`Failed to fetch user: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    return yield* Effect.fail(new Error("Failed to get current user"));
  }

  const data = yield* Effect.tryPromise({
    try: () =>
      response.json() as Promise<{
        user: { id: string; email: string; createdAt: string };
      }>,
    catch: (error) => new Error(`Failed to parse user JSON: ${error}`),
  });

  // Cache the result
  yield* setCached(CacheKeys.user, data.user);

  return data.user;
});

export const logout = Effect.gen(function* () {
  if (!navigator.onLine) {
    return yield* Effect.fail(new Error("Cannot logout while offline"));
  }

  const response: Response = yield* Effect.tryPromise({
    try: () =>
      fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }),
    catch: (error) => new Error(`Failed to logout: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    return yield* Effect.fail(new Error("Failed to logout"));
  }

  // Clear all cache on logout
  yield* clearCache();

  // Redirect to login page after successful logout
  window.location.href = "/login";
});
