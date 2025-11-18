import { Effect } from "effect";
import type { User } from "~/lib/types.ts";

export const login = (email: string, password: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to login: ${error}`),
    });

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Login failed" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ user: User }>,
      catch: (error) => new Error(`Failed to parse response: ${error}`),
    });

    yield* Effect.log(`✅ Logged in as ${data.user.email}`);
  });

export const register = (
  email: string,
  password: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
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
        catch: () => ({ error: "Registration failed" }),
      });
      yield* Effect.fail(new Error(errorData.error));
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
    const response = yield* Effect.tryPromise({
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

