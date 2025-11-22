import { Effect } from "effect";
import type { JWTPayload } from "../types.ts";
import { AuthError, CsrfError } from "../types.ts";
import { verify } from "./jwt.ts";

// WeakMap to store verified userId per request (set by middleware)
const verifiedUserIdMap = new WeakMap<Request, string>();

const parseCookieHeader = (
  cookieHeader: string | null
): Record<string, string> => {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split("=");
    if (name && valueParts.length > 0) {
      cookies[name] = decodeURIComponent(valueParts.join("="));
    }
  }

  return cookies;
};

export const extractToken = (
  req: Request
): Effect.Effect<string | null, Error> =>
  Effect.sync(() => {
    const cookieHeader = req.headers.get("cookie");
    // console.log("[extractToken] Cookie header:", cookieHeader);
    const cookies = parseCookieHeader(cookieHeader);
    // console.log("[extractToken] Parsed cookies:", cookies);

    const token = cookies["token"];
    if (token) {
      // console.log("[extractToken] Found token in cookies");
      return token;
    }

    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      // console.log("[extractToken] Found token in Authorization header");
      return authHeader.slice(7);
    }

    // console.log("[extractToken] No token found");
    return null;
  });

export const getUserId = (req: Request): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const token = yield* extractToken(req);

    if (!token) {
      yield* Effect.fail(new AuthError("No authentication token provided"));
    }

    const payload: JWTPayload = yield* Effect.catchAll(
      verify(token as string),
      (error) =>
        Effect.fail(
          new AuthError(
            error instanceof Error
              ? error.message
              : "Invalid authentication token"
          )
        )
    );

    return payload.userId;
  });

/**
 * Stores verified userId in WeakMap for later retrieval by handlers.
 * Should only be called by middleware after successful verification.
 */
export const setVerifiedUserId = (req: Request, userId: string): void => {
  verifiedUserIdMap.set(req, userId);
};

/**
 * Gets userId from WeakMap (assumes middleware already verified).
 * Throws if userId not found (should not happen if middleware ran).
 */
export const getVerifiedUserId = (req: Request): Effect.Effect<string, Error> =>
  Effect.sync(() => {
    const userId = verifiedUserIdMap.get(req);
    if (!userId) {
      throw new AuthError(
        "Request not authenticated (middleware should have verified)"
      );
    }
    return userId;
  });

export const getAuthPayload = (
  req: Request
): Effect.Effect<JWTPayload, Error> =>
  Effect.gen(function* () {
    const token = yield* extractToken(req);

    if (!token) {
      yield* Effect.fail(new AuthError("No authentication token provided"));
    }

    return yield* Effect.catchAll(verify(token as string), (error) =>
      Effect.fail(
        new AuthError(
          error instanceof Error
            ? error.message
            : "Invalid authentication token"
        )
      )
    );
  });

export const requireAuth =
  <T>(handler: (req: Request, userId: string) => Effect.Effect<T, Error>) =>
  (req: Request): Effect.Effect<T, Error> =>
    Effect.gen(function* () {
      // Try to get verified userId first (if middleware already verified)
      // Fall back to verifying if not found (for backwards compatibility)
      const userId = yield* Effect.catchAll(getVerifiedUserId(req), () =>
        getUserId(req)
      );
      return yield* handler(req, userId);
    });

const unwrapFiberFailure = (error: unknown): unknown => {
  if (!error || typeof error !== "object") {
    return error;
  }

  // Check for cause property (Effect's FiberFailure structure)
  if ("cause" in error && error.cause) {
    return unwrapFiberFailure(error.cause);
  }

  // Check for error property
  if ("error" in error && error.error) {
    return unwrapFiberFailure(error.error);
  }

  return error;
};

export const isAuthError = (error: unknown): error is AuthError => {
  const unwrapped = unwrapFiberFailure(error);

  // Check unwrapped error
  if (unwrapped instanceof AuthError) {
    return true;
  }
  if (unwrapped instanceof Error && unwrapped.name === "AuthError") {
    return true;
  }

  // Check original error's string representation for auth-related messages
  if (error instanceof Error) {
    const errorStr = error.toString();
    const authKeywords = [
      "AuthError",
      "authentication token",
      "No authentication token",
      "Invalid token",
      "Token expired",
    ];
    if (authKeywords.some((keyword) => errorStr.includes(keyword))) {
      return true;
    }
  }

  return false;
};

export const isCsrfError = (error: unknown): error is CsrfError => {
  const unwrapped = unwrapFiberFailure(error);

  // Check unwrapped error
  if (unwrapped instanceof CsrfError) {
    return true;
  }
  if (unwrapped instanceof Error && unwrapped.name === "CsrfError") {
    return true;
  }

  // Check original error's string representation for CSRF-related messages
  if (error instanceof Error) {
    const errorStr = error.toString();
    const csrfKeywords = ["CsrfError", "CSRF token", "csrf token"];
    if (csrfKeywords.some((keyword) => errorStr.includes(keyword))) {
      return true;
    }
  }

  return false;
};

const AUTH_ERROR_MESSAGE_REGEX = /AuthError:\s*(.+)/;

export const extractErrorMessage = (error: unknown): string => {
  const unwrapped = unwrapFiberFailure(error);

  if (unwrapped instanceof Error) {
    return unwrapped.message;
  }

  if (error instanceof Error) {
    // Try to extract message from FiberFailure string representation
    const errorStr = error.toString();
    const match = errorStr.match(AUTH_ERROR_MESSAGE_REGEX);
    if (match?.[1]) {
      return match[1].trim();
    }
    return error.message;
  }

  return String(error);
};

export const createAuthErrorResponse = (message: string): Response =>
  Response.json({ error: message }, { status: 401 });

export const createAuthSuccessResponse = (data: unknown): Response =>
  Response.json(data);

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
 * Sets authentication cookie with secure flags.
 * Adds Secure flag when using HTTPS (detected via headers or NODE_ENV).
 * Uses SameSite=Lax for better compatibility while maintaining security.
 */
export const setAuthCookie = (
  response: Response,
  token: string,
  req?: Request,
  maxAge: number = 7 * 24 * 60 * 60
): Response => {
  const useSecure = isHttps(req);
  // console.log("[setAuthCookie] Setting auth cookie, useSecure:", useSecure);

  // Build cookie string with proper formatting
  const cookieParts = [
    `token=${token}`,
    "HttpOnly",
    "SameSite=Lax", // Changed from Strict to Lax for better compatibility
    `Max-Age=${maxAge}`,
    "Path=/",
  ];

  // Add Secure flag only when using HTTPS
  if (useSecure) {
    cookieParts.push("Secure");
  }

  const cookieValue = cookieParts.join("; ");
  // console.log("[setAuthCookie] Cookie value:", cookieValue);
  response.headers.set("Set-Cookie", cookieValue);
  return response;
};

/**
 * Clears authentication cookie by setting Max-Age=0.
 * Uses same security settings as setAuthCookie for consistency.
 */
export const clearAuthCookie = (
  response: Response,
  req?: Request
): Response => {
  const useSecure = isHttps(req);

  const cookieParts = [
    "token=",
    "HttpOnly",
    "SameSite=Lax", // Changed from Strict to Lax for better compatibility
    "Max-Age=0",
    "Path=/",
  ];

  // Add Secure flag only when using HTTPS
  if (useSecure) {
    cookieParts.push("Secure");
  }

  response.headers.set("Set-Cookie", cookieParts.join("; "));
  return response;
};
