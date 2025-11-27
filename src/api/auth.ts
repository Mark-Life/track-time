import { Effect } from "effect";
import {
  clearAuthCookie,
  createAuthErrorResponse,
  createAuthSuccessResponse,
  isAuthError,
  requireAuth,
  setAuthCookie,
} from "~/lib/auth/auth";
import { createCsrfToken, setCsrfCookie } from "~/lib/auth/csrf";
import { sign } from "~/lib/auth/jwt";
import {
  rateLimitAuth,
  recordFailedAttempt,
  recordSuccess,
} from "~/lib/auth/rate-limit";
import { authenticateUser, createUser, getUserById } from "~/lib/auth/users";
import { AuthError, type User } from "~/lib/types";

const parseAuthBody = (
  req: Request
): Effect.Effect<{ email: string; password: string }, Error> =>
  Effect.gen(function* () {
    const body: unknown = yield* Effect.tryPromise({
      try: () => req.json(),
      catch: (error) => new Error(`Failed to parse request body: ${error}`),
    });

    if (
      !body ||
      typeof body !== "object" ||
      !("email" in body) ||
      !("password" in body) ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      yield* Effect.fail(new Error("email and password are required strings"));
    }

    return {
      email: (body as { email: string; password: string }).email,
      password: (body as { email: string; password: string }).password,
    };
  });

export const handleRegister = (req: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { email, password } = yield* parseAuthBody(req);

      // Check rate limit before processing
      yield* rateLimitAuth(req, email, "register");

      // Attempt user creation, record failed attempt on error
      const user: User = yield* Effect.tapError(
        createUser(email, password),
        () => recordFailedAttempt(req, email, "register")
      );

      // Record success and reset rate limit
      yield* recordSuccess(req, email, "register");

      const token: string = yield* sign(
        {
          userId: user.id,
          email: user.email,
        },
        7 * 24 * 60 * 60
      );

      const response = createAuthSuccessResponse({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
      });

      // Set auth cookie
      const responseWithAuth = setAuthCookie(response, token, req);

      // Generate and set CSRF token
      const csrfToken = yield* createCsrfToken(user.id);
      return setCsrfCookie(responseWithAuth, csrfToken, req);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse("");
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to register user",
      },
      { status: 500 }
    );
  });

export const handleLogin = (req: Request) => {
  console.log("[handleLogin] Login request received");
  console.log("[handleLogin] URL:", req.url);
  console.log("[handleLogin] Method:", req.method);

  // Log headers
  const headersObj: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headersObj[key] = value;
  });
  console.log("[handleLogin] Headers:", headersObj);

  return Effect.runPromise(
    Effect.gen(function* () {
      console.log("[handleLogin] Parsing auth body");
      const { email, password } = yield* parseAuthBody(req);
      console.log("[handleLogin] Email:", email);

      // Check rate limit before processing
      console.log("[handleLogin] Checking rate limit");
      yield* rateLimitAuth(req, email, "login");

      // Attempt authentication, record failed attempt on error
      console.log("[handleLogin] Attempting authentication");
      const user: User = yield* Effect.tapError(
        authenticateUser(email, password),
        (error) => {
          console.error("[handleLogin] Authentication failed:", error);
          return recordFailedAttempt(req, email, "login");
        }
      );

      console.log("[handleLogin] Authentication successful, user ID:", user.id);

      // Record success and reset rate limit
      yield* recordSuccess(req, email, "login");

      const token: string = yield* sign(
        {
          userId: user.id,
          email: user.email,
        },
        7 * 24 * 60 * 60
      );

      const response = createAuthSuccessResponse({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
      });

      // Set auth cookie
      const responseWithAuth = setAuthCookie(response, token, req);

      // Generate and set CSRF token
      console.log("[handleLogin] Setting CSRF token");
      const csrfToken = yield* createCsrfToken(user.id);
      const finalResponse = setCsrfCookie(responseWithAuth, csrfToken, req);
      console.log("[handleLogin] Login successful, returning response");
      return finalResponse;
    })
  ).catch((error) => {
    console.error("[handleLogin] Error caught:", error);
    if (isAuthError(error)) {
      console.error("[handleLogin] Auth error:", error.message);
      return createAuthErrorResponse("");
    }

    console.error("[handleLogin] Unexpected error:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to authenticate",
      },
      { status: 500 }
    );
  });
};

export const handleLogout = (req: Request) =>
  Effect.runPromise(
    Effect.sync(() => {
      const response = createAuthSuccessResponse({ success: true });
      return clearAuthCookie(response, req);
    })
  ).catch((error) =>
    Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to logout",
      },
      { status: 500 }
    )
  );

export const handleMe = async (req: Request): Promise<Response> => {
  try {
    return await Effect.runPromise(
      requireAuth((_req, userId) =>
        Effect.gen(function* () {
          const user = yield* getUserById(userId);

          if (!user) {
            yield* Effect.fail(new AuthError("Invalid email or password"));
          }

          // TypeScript doesn't narrow after Effect.fail, so we assert non-null
          const userData = user as NonNullable<typeof user>;

          const response = createAuthSuccessResponse({
            user: {
              id: userData.id,
              email: userData.email,
              createdAt: userData.createdAt,
            },
          });

          // Generate and set CSRF token
          const csrfToken = yield* createCsrfToken(userId);
          return setCsrfCookie(response, csrfToken, _req);
        })
      )(req)
    ).catch((error) => {
      console.error(
        "handleMe error:",
        error,
        "isAuthError:",
        isAuthError(error)
      );
      if (isAuthError(error)) {
        return createAuthErrorResponse("");
      }

      console.error("handleMe: Returning 500 for non-auth error:", error);
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Failed to get user",
        },
        { status: 500 }
      );
    });
  } catch (error) {
    console.error("handleMe: Unhandled exception:", error);
    if (isAuthError(error)) {
      return createAuthErrorResponse("");
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
};

/**
 * Handles JWT token refresh request.
 * Returns a new JWT token for the authenticated user.
 */
export const handleRefreshToken = async (req: Request): Promise<Response> => {
  try {
    return await Effect.runPromise(
      requireAuth((_req, userId) =>
        Effect.gen(function* () {
          const user = yield* getUserById(userId);

          if (!user) {
            yield* Effect.fail(new AuthError("Invalid email or password"));
          }

          // TypeScript doesn't narrow after Effect.fail, so we assert non-null
          const userData = user as NonNullable<typeof user>;

          // Generate new JWT token
          const token: string = yield* sign(
            {
              userId: userData.id,
              email: userData.email,
            },
            7 * 24 * 60 * 60
          );

          const response = createAuthSuccessResponse({
            token,
            expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          });

          // Set auth cookie
          const responseWithAuth = setAuthCookie(response, token, _req);

          // Generate and set CSRF token
          const csrfToken = yield* createCsrfToken(userId);
          return setCsrfCookie(responseWithAuth, csrfToken, _req);
        })
      )(req)
    ).catch((error) => {
      if (isAuthError(error)) {
        return createAuthErrorResponse("");
      }

      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to refresh token",
        },
        { status: 500 }
      );
    });
  } catch (error) {
    if (isAuthError(error)) {
      return createAuthErrorResponse("");
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to refresh token",
      },
      { status: 500 }
    );
  }
};

/**
 * Handles CSRF token refresh request.
 * Returns a new CSRF token for the authenticated user.
 */
export const handleCsrfToken = async (req: Request): Promise<Response> => {
  try {
    return await Effect.runPromise(
      requireAuth((_req, userId) =>
        Effect.gen(function* () {
          const csrfToken = yield* createCsrfToken(userId);
          const response = createAuthSuccessResponse({ csrfToken });
          return setCsrfCookie(response, csrfToken, _req);
        })
      )(req)
    ).catch((error) => {
      if (isAuthError(error)) {
        return createAuthErrorResponse("");
      }

      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate CSRF token",
        },
        { status: 500 }
      );
    });
  } catch (error) {
    if (isAuthError(error)) {
      return createAuthErrorResponse("");
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate CSRF token",
      },
      { status: 500 }
    );
  }
};
