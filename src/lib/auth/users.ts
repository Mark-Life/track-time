import { redis } from "bun";
import { Effect } from "effect";
import type { User } from "~/lib/types.ts";
import { AuthError } from "~/lib/types.ts";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;
const SPECIAL_CHAR_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
const REPEATED_CHAR_REGEX = /(.)\1{4,}/;

const COMMON_PASSWORDS = [
  "password",
  "password123",
  "12345678",
  "qwerty123",
  "abc12345",
  "letmein",
  "welcome123",
  "admin123",
] as const;

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "0123456789",
  "9876543210",
] as const;

const validateEmail = (email: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!EMAIL_REGEX.test(email)) {
      yield* Effect.fail(new AuthError("Invalid email format"));
    }
  });

/**
 * Validates password length requirements.
 */
const validatePasswordLength = (password: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (password.length < 8) {
      yield* Effect.fail(
        new AuthError("Password must be at least 8 characters long")
      );
    }

    if (password.length > 128) {
      yield* Effect.fail(
        new AuthError("Password must be no more than 128 characters long")
      );
    }
  });

/**
 * Validates password character requirements.
 */
const validatePasswordChars = (password: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!UPPERCASE_REGEX.test(password)) {
      yield* Effect.fail(
        new AuthError("Password must contain at least one uppercase letter")
      );
    }

    if (!LOWERCASE_REGEX.test(password)) {
      yield* Effect.fail(
        new AuthError("Password must contain at least one lowercase letter")
      );
    }

    if (!NUMBER_REGEX.test(password)) {
      yield* Effect.fail(
        new AuthError("Password must contain at least one number")
      );
    }

    if (!SPECIAL_CHAR_REGEX.test(password)) {
      yield* Effect.fail(
        new AuthError(
          "Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;':\",./<>?)"
        )
      );
    }
  });

/**
 * Validates password against common weak patterns.
 */
const validatePasswordStrength = (
  password: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const passwordLower = password.toLowerCase();

    // Check for common weak passwords
    if (COMMON_PASSWORDS.some((weak) => passwordLower.includes(weak))) {
      yield* Effect.fail(
        new AuthError(
          "Password is too common or weak. Please choose a stronger password"
        )
      );
    }

    // Check for repeated characters (e.g., "aaaaaa", "11111111")
    if (REPEATED_CHAR_REGEX.test(password)) {
      yield* Effect.fail(
        new AuthError("Password contains too many repeated characters")
      );
    }

    // Check for sequential characters (e.g., "abcdef", "123456")
    for (const seq of SEQUENCES) {
      for (let i = 0; i <= seq.length - 4; i++) {
        const subseq = seq.slice(i, i + 4);
        if (passwordLower.includes(subseq)) {
          yield* Effect.fail(
            new AuthError(
              "Password contains sequential characters. Please choose a stronger password"
            )
          );
        }
      }
    }
  });

/**
 * Validates password strength and complexity requirements.
 * Requirements:
 * - Minimum 8 characters
 * - Maximum 128 characters (prevent DoS)
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * - Not a common weak password
 */
const validatePassword = (password: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* validatePasswordLength(password);
    yield* validatePasswordChars(password);
    yield* validatePasswordStrength(password);
  });

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

/**
 * Atomically creates a user, preventing race conditions.
 * Uses SADD which atomically checks and adds email to set.
 * Returns 1 if email was added (didn't exist), 0 if already exists.
 */
export const createUser = (
  email: string,
  password: string
): Effect.Effect<User, Error> =>
  Effect.gen(function* () {
    yield* validateEmail(email);
    yield* validatePassword(password);

    const normalizedEmail = normalizeEmail(email);

    // Hash password before atomic operation
    const passwordHash: string = yield* Effect.tryPromise({
      try: () => Bun.password.hash(password),
      catch: (error) => new Error(`Failed to hash password: ${error}`),
    });

    const userId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Atomically check and add email to set
    // SADD returns 1 if element was added (didn't exist), 0 if already exists
    // This is atomic and prevents race conditions - only one request can add the email
    const emailAdded: number = yield* Effect.tryPromise({
      try: () => redis.sadd("users:emails", normalizedEmail),
      catch: (error) =>
        new Error(`Failed to check/add email atomically: ${error}`),
    });

    if (emailAdded === 0) {
      // Email already exists - race condition prevented
      yield* Effect.fail(new AuthError("Email already registered"));
    }

    // Email was successfully reserved atomically, now create user data
    // If creation fails, attempt cleanup (best effort)
    yield* Effect.catchAll(
      Effect.gen(function* () {
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
          try: () =>
            redis.hset(`user:email:${normalizedEmail}`, { id: userId }),
          catch: (error) =>
            new Error(`Failed to create email mapping: ${error}`),
        });
      }),
      (error) =>
        Effect.gen(function* () {
          // Cleanup: remove email from set if user creation failed (best effort)
          // Use Effect.ignore to ignore cleanup errors
          yield* Effect.ignore(
            Effect.tryPromise({
              try: () => redis.srem("users:emails", normalizedEmail),
              catch: (cleanupError) => {
                console.error(
                  `Warning: Failed to cleanup email from set after user creation failure: ${normalizedEmail}`,
                  cleanupError
                );
                return new Error("Cleanup failed");
              },
            })
          );
          return yield* Effect.fail(error);
        })
    );

    const user: User = {
      id: userId,
      email: normalizedEmail,
      createdAt,
    };

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

    const disabledValue = userData["disabled"];
    const disabled =
      disabledValue === "true" ||
      disabledValue === true ||
      disabledValue === "1";

    const user: User = {
      id: userId as string,
      email: userData["email"] as string,
      createdAt: userData["createdAt"] as string,
      disabled: disabled || undefined,
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

    const disabledValue = userData["disabled"];
    const disabled =
      disabledValue === "true" ||
      disabledValue === true ||
      disabledValue === "1";

    const user: User = {
      id: id as string,
      email: userData["email"] as string,
      createdAt: userData["createdAt"] as string,
      disabled: disabled || undefined,
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
