import { Effect } from "effect";
import { extractToken } from "./auth.ts";
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

    yield* Effect.log(`[middleware] Checking auth for ${pathname}`);

    // Only check auth for app routes
    if (!isAppRoute(pathname)) {
      return null;
    }

    const token = yield* extractToken(req);

    if (!token) {
      return createRedirectResponse("/login");
    }

    try {
      yield* verify(token);
      return null;
    } catch {
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

    const token = yield* extractToken(req);

    if (!token) {
      return createRedirectResponse("/login");
    }

    try {
      yield* verify(token);
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
