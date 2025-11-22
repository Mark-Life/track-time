import { Effect } from "effect";
import { extractToken, getVerifiedUserId, setVerifiedUserId } from "./auth.ts";
import { requireCsrfToken } from "./csrf.ts";
import { verify } from "./jwt.ts";
import { rateLimitApi } from "./rate-limit-general.ts";

export type Middleware = (
  req: Request
) => Effect.Effect<Response | null, Error>;

const createRedirectResponse = (location: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
    },
  });

const CHUNK_PATTERN = /^\/chunk-[a-z0-9]+\.(js|css)$/i;

const isAppRoute = (pathname: string): boolean => pathname.startsWith("/app");

const isApiRoute = (pathname: string): boolean => pathname.startsWith("/api");

const isPublicApiRoute = (pathname: string): boolean => {
  const publicRoutes = [
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/logout",
  ];
  return publicRoutes.some((route) => pathname === route);
};

const isPublicAssetPath = (pathname: string): boolean => {
  // Public assets that don't require auth (needed for login page)
  if (pathname === "/tailwindcss" || pathname.startsWith("/tailwindcss")) {
    return true;
  }
  if (pathname.startsWith("/~/")) {
    return true;
  }
  return false;
};

const isAssetPath = (pathname: string): boolean => {
  // Check for CSS files
  if (pathname.endsWith(".css")) {
    return true;
  }

  // Check for JS files
  if (pathname.endsWith(".js")) {
    return true;
  }

  // Check for Bun's special imports
  if (pathname === "/tailwindcss" || pathname.startsWith("/tailwindcss")) {
    return true;
  }

  // Check for path alias imports (~/)
  if (pathname.startsWith("/~/")) {
    return true;
  }

  // Check for build output patterns (chunk-*.js, chunk-*.css)
  if (pathname.startsWith("/chunk-") || CHUNK_PATTERN.test(pathname)) {
    return true;
  }

  return false;
};

const MAX_REQUEST_SIZE = 1024 * 1024; // 1 MB

/**
 * Validates request size to prevent oversized requests.
 * Checks Content-Length header for requests with bodies.
 */
export const validateRequestSize: Middleware = (req) => {
  // Only check requests with bodies
  const hasBody =
    req.method === "POST" || req.method === "PUT" || req.method === "PATCH";

  if (!hasBody) {
    return Effect.succeed(null);
  }

  const contentLength = req.headers.get("content-length");

  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);

    if (Number.isNaN(size) || size < 0) {
      return Effect.succeed(
        Response.json(
          { error: "Invalid Content-Length header" },
          { status: 400 }
        )
      );
    }

    if (size > MAX_REQUEST_SIZE) {
      return Effect.succeed(
        Response.json(
          {
            error: `Request body too large. Maximum size is ${MAX_REQUEST_SIZE} bytes (1 MB)`,
          },
          { status: 413 }
        )
      );
    }
  }

  return Effect.succeed(null);
};

export const requireAuth: Middleware = (req) =>
  Effect.gen(function* () {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Check auth for app routes and API routes (except public auth routes)
    const shouldCheckAuth =
      isAppRoute(pathname) ||
      (isApiRoute(pathname) && !isPublicApiRoute(pathname));

    if (!shouldCheckAuth) {
      return null;
    }

    console.log("[requireAuth] Checking auth for:", pathname);
    const token = yield* extractToken(req);

    if (!token) {
      console.log("[requireAuth] No token found, blocking request");
      // For API routes, return 401; for app routes, redirect
      if (isApiRoute(pathname)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return createRedirectResponse("/login");
    }

    try {
      const payload = yield* verify(token);
      // Store verified userId for handlers to use
      setVerifiedUserId(req, payload.userId);
      return null;
    } catch {
      // For API routes, return 401; for app routes, redirect
      if (isApiRoute(pathname)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return createRedirectResponse("/login");
    }
  });

export const requireAuthForAssets: Middleware = (req) =>
  Effect.gen(function* () {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only check auth for asset paths
    if (!isAssetPath(pathname)) {
      return null;
    }

    // Public assets (like /tailwindcss, /~/global.css) don't require auth
    // These are needed for the login page to work
    if (isPublicAssetPath(pathname)) {
      return null;
    }

    const token = yield* extractToken(req);

    if (!token) {
      return createRedirectResponse("/login");
    }

    try {
      const payload = yield* verify(token);
      // Store verified userId for handlers to use (though assets don't need it)
      setVerifiedUserId(req, payload.userId);
      return null;
    } catch {
      return createRedirectResponse("/login");
    }
  });

/**
 * Rate limiting middleware for API endpoints.
 * Tracks requests by userId and HTTP method.
 * Returns 429 Too Many Requests if rate limit exceeded.
 */
export const rateLimitApiMiddleware: Middleware = (req) =>
  Effect.gen(function* () {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only check rate limit for API routes (not app routes or assets)
    if (!isApiRoute(pathname)) {
      return null;
    }

    // Skip rate limit check for public routes (login/register have their own rate limiting)
    if (isPublicApiRoute(pathname)) {
      return null;
    }

    // Get verified userId (must be authenticated at this point)
    const userId: string = yield* Effect.catchAll(getVerifiedUserId(req), () =>
      Effect.fail(new Error("User not authenticated"))
    );

    // Check rate limit
    const rateLimitResult = yield* Effect.either(
      rateLimitApi(userId, req.method)
    );

    if (rateLimitResult._tag === "Left") {
      const error = rateLimitResult.left;
      const resetAt: number = error.resetAt;
      const remaining: number = error.remaining;
      const limit: number = error.limit;
      const retryAfter = Math.ceil(resetAt - Math.floor(Date.now() / 1000));

      return Response.json(
        {
          error: "Rate limit exceeded",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": resetAt.toString(),
          },
        }
      );
    }

    return null;
  });

/**
 * CSRF protection middleware.
 * Validates CSRF token for authenticated state-changing requests.
 */
export const requireCsrf: Middleware = (req) =>
  Effect.gen(function* () {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only check CSRF for API routes (not app routes or assets)
    if (!isApiRoute(pathname)) {
      return null;
    }

    // Skip CSRF check for public routes
    if (isPublicApiRoute(pathname)) {
      return null;
    }

    // Get verified userId (must be authenticated at this point)
    const userId: string = yield* Effect.catchAll(getVerifiedUserId(req), () =>
      Effect.fail(new Error("User not authenticated"))
    );

    // Validate CSRF token
    yield* requireCsrfToken(req, userId);

    return null;
  });

export const compose =
  (...middlewares: Middleware[]) =>
  (req: Request): Effect.Effect<Response | null, Error> =>
    Effect.gen(function* () {
      for (const middleware of middlewares) {
        const result = yield* middleware(req);
        if (result !== null) {
          return result;
        }
      }
      return null;
    });
