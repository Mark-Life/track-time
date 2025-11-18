import { redis } from "bun";
import { Effect } from "effect";
import type { User } from "./types.ts";
import { AuthError } from "./types.ts";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateEmail = (email: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!EMAIL_REGEX.test(email)) {
      yield* Effect.fail(new AuthError("Invalid email format"));
    }
  });

const validatePassword = (password: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (password.length < 8) {
      yield* Effect.fail(
        new AuthError("Password must be at least 8 characters long")
      );
    }
  });

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

export const createUser = (
  email: string,
  password: string
): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    yield* validateEmail(email);
    yield* validatePassword(password);

    const normalizedEmail = normalizeEmail(email);

    const exists = yield* Effect.tryPromise({
      try: () => redis.sismember("users:emails", normalizedEmail),
      catch: (error) => new Error(`Failed to check email existence: ${error}`),
    });

    if (exists) {
      yield* Effect.fail(new AuthError("Email already registered"));
    }

    const passwordHash = yield* Effect.tryPromise({
      try: () => Bun.password.hash(password),
      catch: (error) => new Error(`Failed to hash password: ${error}`),
    });

    const userId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const user: User = {
      id: userId,
      email: normalizedEmail,
      createdAt,
    };

    yield* Effect.tryPromise({
      try: () =>
        redis.hset(`user:${userId}`, {
          id: userId,
          email: normalizedEmail,
          createdAt,
          passwordHash,
        }),
      catch: (error) => new Error(`Failed to create user: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd("users:emails", normalizedEmail),
      catch: (error) => new Error(`Failed to add email to index: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.hset(`user:email:${normalizedEmail}`, { id: userId }),
      catch: (error) => new Error(`Failed to create email mapping: ${error}`),
    });

    yield* Effect.log(`✅ Created user: ${normalizedEmail} (${userId})`);

    return user;
  });

export const authenticateUser = (
  email: string,
  password: string
): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    const normalizedEmail = normalizeEmail(email);

    const userId: string | null = yield* Effect.tryPromise({
      try: () => redis.hget(`user:email:${normalizedEmail}`, "id"),
      catch: (error) => new Error(`Failed to get user ID: ${error}`),
    });

    if (!userId) {
      yield* Effect.fail(new AuthError("Invalid email or password"));
    }

    const userData = yield* Effect.tryPromise({
      try: () => redis.hgetall(`user:${userId as string}`),
      catch: (error) => new Error(`Failed to get user data: ${error}`),
    });

    if (!userData) {
      yield* Effect.fail(new AuthError("Invalid email or password"));
    }

    const passwordHash = userData["passwordHash"];
    if (!passwordHash) {
      yield* Effect.fail(new AuthError("Invalid email or password"));
    }

    const isValid = yield* Effect.tryPromise({
      try: () => Bun.password.verify(password, passwordHash as string),
      catch: (error) => new Error(`Failed to verify password: ${error}`),
    });

    if (!isValid) {
      yield* Effect.fail(new AuthError("Invalid email or password"));
    }

    const user: User = {
      id: userId as string,
      email: userData["email"] as string,
      createdAt: userData["createdAt"] as string,
    };

    return user;
  });

export const getUserById = (
  userId: string
): Effect.Effect<User | null, Error> =>
  Effect.gen(function* () {
    const userData = yield* Effect.tryPromise({
      try: () => redis.hgetall(`user:${userId}`),
      catch: (error) => new Error(`Failed to get user: ${error}`),
    });

    if (!userData) {
      return null;
    }

    const id = userData["id"];
    if (!id) {
      return null;
    }

    const user: User = {
      id: id as string,
      email: userData["email"] as string,
      createdAt: userData["createdAt"] as string,
    };

    return user;
  });

export const getUserByEmail = (
  email: string
): Effect.Effect<User | null, Error> =>
  Effect.gen(function* () {
    const normalizedEmail = normalizeEmail(email);

    const userId: string | null = yield* Effect.tryPromise({
      try: () => redis.hget(`user:email:${normalizedEmail}`, "id"),
      catch: (error) => new Error(`Failed to get user ID: ${error}`),
    });

    if (!userId) {
      return null;
    }

    return yield* getUserById(userId);
  });
