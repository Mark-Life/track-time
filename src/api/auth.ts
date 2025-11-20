import { Effect } from "effect";
import {
  clearAuthCookie,
  createAuthErrorResponse,
  createAuthSuccessResponse,
  extractErrorMessage,
  isAuthError,
  requireAuth,
  setAuthCookie,
} from "~/lib/auth/auth";
import { sign } from "~/lib/auth/jwt";
import {
  rateLimitAuth,
  recordFailedAttempt,
  recordSuccess,
} from "~/lib/auth/rate-limit.ts";
import { authenticateUser, createUser, getUserById } from "~/lib/auth/users";
import { AuthError, type User } from "~/lib/types.ts";

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

      return setAuthCookie(response, token);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse(error.message);
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to register user",
      },
      { status: 500 }
    );
  });

export const handleLogin = (req: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { email, password } = yield* parseAuthBody(req);

      // Check rate limit before processing
      yield* rateLimitAuth(req, email, "login");

      // Attempt authentication, record failed attempt on error
      const user: User = yield* Effect.tapError(
        authenticateUser(email, password),
        () => recordFailedAttempt(req, email, "login")
      );

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

      return setAuthCookie(response, token);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse(error.message);
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to authenticate",
      },
      { status: 500 }
    );
  });

export const handleLogout = () =>
  Effect.runPromise(
    Effect.sync(() => {
      const response = createAuthSuccessResponse({ success: true });
      return clearAuthCookie(response);
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
            yield* Effect.fail(new AuthError("User not found"));
          }

          // TypeScript doesn't narrow after Effect.fail, so we assert non-null
          const userData = user as NonNullable<typeof user>;

          return createAuthSuccessResponse({
            user: {
              id: userData.id,
              email: userData.email,
              createdAt: userData.createdAt,
            },
          });
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
        return createAuthErrorResponse(extractErrorMessage(error));
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
      return createAuthErrorResponse(extractErrorMessage(error));
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
};
