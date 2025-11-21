import { Effect } from "effect";
import type { User } from "~/lib/types.ts";

export const login = (
  email: string,
  password: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    console.log("[Login] Attempting login for:", email);

    const response: Response = yield* Effect.tryPromise({
      try: () => {
        console.log("[Login] Sending request to /api/auth/login");
        return fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        });
      },
      catch: (error) => {
        console.error("[Login] Fetch error:", error);
        return new Error(`Failed to login: ${error}`);
      },
    });

    console.log(
      "[Login] Response status:",
      response.status,
      response.statusText
    );

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => new Error("Login failed"),
      });
      console.error("[Login] Error response:", errorData);
      const errorMessage =
        errorData instanceof Error ? errorData.message : errorData.error;
      yield* Effect.fail(new Error(errorMessage));
    }

    const data: { user: User } = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ user: User }>,
      catch: (error) => {
        console.error("[Login] Parse error:", error);
        return new Error(`Failed to parse response: ${error}`);
      },
    });

    console.log(`[Login] ✅ Logged in as ${data.user.email}`);
    yield* Effect.log(`✅ Logged in as ${data.user.email}`);
  });

export const register = (
  email: string,
  password: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const response: Response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to register: ${error}`),
    });

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => new Error("Registration failed"),
      });
      const errorMessage =
        errorData instanceof Error ? errorData.message : errorData.error;
      yield* Effect.fail(new Error(errorMessage));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ user: User }>,
      catch: (error) => new Error(`Failed to parse response: ${error}`),
    });

    yield* Effect.log(`✅ Registered as ${data.user.email}`);
  });

export const logout = (): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to logout: ${error}`),
    });

    if (!response.ok) {
      yield* Effect.fail(new Error("Logout failed"));
    }

    window.location.href = "/login";
  });

export const getCurrentUser = (): Effect.Effect<User | null, Error> =>
  Effect.gen(function* () {
    const response: Response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/me", {
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to get current user: ${error}`),
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      yield* Effect.fail(new Error("Failed to get current user"));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ user: User }>,
      catch: (error) => new Error(`Failed to parse response: ${error}`),
    });

    return data.user;
  });
