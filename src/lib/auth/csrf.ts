import { redis } from "bun";
import { Effect } from "effect";
import { CsrfError } from "../types.ts";

/**
 * CSRF token expiration time (1 hour)
 */
const CSRF_TOKEN_TTL = 60 * 60;

/**
 * Generates a cryptographically secure CSRF token.
 */
const generateCsrfToken = (): string => {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Buffer.from(randomBytes).toString("base64url");
};

/**
 * Stores CSRF token in Redis with expiration.
 * Token is associated with userId for validation.
 */
export const createCsrfToken = (userId: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const token = generateCsrfToken();
    const key = `csrf:${userId}:${token}`;

    yield* Effect.tryPromise({
      try: () => redis.setex(key, CSRF_TOKEN_TTL, "1"),
      catch: (error) => new Error(`Failed to store CSRF token: ${error}`),
    });

    return token;
  });

/**
 * Validates CSRF token for a user.
 * Returns true if token is valid, false otherwise.
 */
export const validateCsrfToken = (
  userId: string,
  token: string
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    if (!token || token.length === 0) {
      return false;
    }

    const key = `csrf:${userId}:${token}`;
    const exists: boolean = yield* Effect.tryPromise({
      try: async () => {
        const result = await redis.exists(key);
        // redis.exists returns number (0 or 1) in Bun
        return typeof result === "number" ? result === 1 : Boolean(result);
      },
      catch: (error) => new Error(`Failed to validate CSRF token: ${error}`),
    });

    if (exists) {
      // Token is valid - delete it to prevent reuse (double-submit cookie pattern)
      yield* Effect.tryPromise({
        try: async () => {
          await redis.del(key);
        },
        catch: () => new Error("Failed to delete CSRF token"),
      });
      return true;
    }

    return false;
  });

/**
 * Extracts CSRF token from request headers.
 * Checks both X-CSRF-Token header and csrf-token cookie.
 */
export const extractCsrfToken = (
  req: Request
): Effect.Effect<string | null, Error> =>
  Effect.sync(() => {
    // Check header first (preferred)
    const headerToken = req.headers.get("X-CSRF-Token");
    if (headerToken) {
      return headerToken;
    }

    // Fall back to cookie
    const cookieHeader = req.headers.get("cookie");
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.split("=");
      if (name === "csrf-token" && valueParts.length > 0) {
        return decodeURIComponent(valueParts.join("="));
      }
    }

    return null;
  });

/**
 * Checks if the request is over HTTPS (including proxy headers).
 */
const isHttps = (req?: Request): boolean => {
  // Check X-Forwarded-Proto header (common in proxy setups like Vercel)
  if (req) {
    const forwardedProto = req.headers.get("x-forwarded-proto");
    if (forwardedProto === "https") {
      return true;
    }
  }

  // Fallback to NODE_ENV check
  return process.env.NODE_ENV === "production";
};

/**
 * Sets CSRF token cookie in response.
 * Uses SameSite=Lax for better compatibility while maintaining security.
 */
export const setCsrfCookie = (
  response: Response,
  token: string,
  req?: Request
): Response => {
  const useSecure = isHttps(req);

  const cookieParts = [
    `csrf-token=${token}`,
    "SameSite=Lax", // Changed from Strict to Lax for better compatibility
    `Max-Age=${CSRF_TOKEN_TTL}`,
    "Path=/",
  ];

  // Add Secure flag only when using HTTPS
  if (useSecure) {
    cookieParts.push("Secure");
  }

  response.headers.set("Set-Cookie", cookieParts.join("; "));
  return response;
};

/**
 * Middleware to validate CSRF token for state-changing requests.
 * Skips validation for GET, HEAD, OPTIONS requests and public auth routes.
 */
export const requireCsrfToken = (
  req: Request,
  userId: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const method = req.method.toUpperCase();

    // Skip CSRF check for safe methods
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      return;
    }

    // Skip CSRF check for public auth routes (login/register)
    const url = new URL(req.url);
    const publicRoutes = ["/api/auth/login", "/api/auth/register"];
    if (publicRoutes.includes(url.pathname)) {
      return;
    }

    const token = yield* extractCsrfToken(req);
    if (!token) {
      yield* Effect.fail(
        new CsrfError("CSRF token missing. Please refresh the page.")
      );
    }

    const isValid = yield* validateCsrfToken(userId, token as string);
    if (!isValid) {
      yield* Effect.fail(
        new CsrfError("Invalid CSRF token. Please refresh the page.")
      );
    }
  });
