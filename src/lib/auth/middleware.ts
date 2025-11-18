import { Effect } from "effect";
import { extractToken, setVerifiedUserId } from "./auth.ts";
import { verify } from "./jwt.ts";

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

    const token = yield* extractToken(req);

    if (!token) {
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
