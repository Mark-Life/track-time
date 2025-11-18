import { Effect } from "effect";
import {
  clearAuthCookie,
  createAuthErrorResponse,
  createAuthSuccessResponse,
  extractErrorMessage,
  isAuthError,
  requireAuth,
  setAuthCookie,
} from "~/lib/auth.ts";
import { sign } from "~/lib/jwt.ts";
import { AuthError } from "~/lib/types.ts";
import { authenticateUser, createUser, getUserById } from "~/lib/users.ts";

const parseAuthBody = (
  req: Request
): Effect.Effect<{ email: string; password: string }, Error> =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => req.json() as Promise<{ email: string; password: string }>,
      catch: (error) => new Error(`Failed to parse request body: ${error}`),
    });

    if (!body.email || typeof body.email !== "string") {
      yield* Effect.fail(new Error("email is required and must be a string"));
    }

    if (!body.password || typeof body.password !== "string") {
      yield* Effect.fail(
        new Error("password is required and must be a string")
      );
    }

    return {
      email: body.email,
      password: body.password,
    };
  });

export const handleRegister = (req: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { email, password } = yield* parseAuthBody(req);

      const user = yield* createUser(email, password);

      const token = yield* sign(
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

      const user = yield* authenticateUser(email, password);

      const token = yield* sign(
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
