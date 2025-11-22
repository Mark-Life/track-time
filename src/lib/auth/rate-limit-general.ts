import { redis } from "bun";
import { Effect } from "effect";

/**
 * Custom error for rate limit exceeded.
 */
export class RateLimitError extends Error {
  readonly remaining: number;
  readonly resetAt: number;
  readonly limit: number;

  constructor(
    message: string,
    remaining: number,
    resetAt: number,
    limit: number
  ) {
    super(message);
    this.name = "RateLimitError";
    this.remaining = remaining;
    this.resetAt = resetAt;
    this.limit = limit;
  }
}

/**
 * Rate limit configuration for general API endpoints.
 */
const RATE_LIMIT_CONFIG = {
  // Write operations (POST, PUT, DELETE)
  write: {
    maxRequests: 100,
    windowSeconds: 60, // 1 minute
  },
  // Read operations (GET)
  read: {
    maxRequests: 200,
    windowSeconds: 60, // 1 minute
  },
} as const;

/**
 * Determines if an HTTP method is a write operation.
 */
const isWriteOperation = (method: string): boolean =>
  method === "POST" || method === "PUT" || method === "DELETE";

/**
 * Gets rate limit configuration based on HTTP method.
 */
const getRateLimitConfig = (method: string) =>
  isWriteOperation(method) ? RATE_LIMIT_CONFIG.write : RATE_LIMIT_CONFIG.read;

/**
 * Checks if rate limit is exceeded for a given userId and HTTP method.
 * Returns rate limit status with remaining requests and reset time.
 */
const checkRateLimit = (
  userId: string,
  method: string
): Effect.Effect<
  {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    limit: number;
  },
  Error
> =>
  Effect.gen(function* () {
    const config = getRateLimitConfig(method);
    const key = `rate_limit:api:${method.toLowerCase()}:${userId}`;

    // Get current request count
    const countStr: string | null = yield* Effect.tryPromise({
      try: () => redis.get(key),
      catch: (error) => new Error(`Failed to get rate limit count: ${error}`),
    });

    const count = countStr ? Number.parseInt(countStr, 10) : 0;
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now + config.windowSeconds;

    if (count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: config.maxRequests,
      };
    }

    const remaining = config.maxRequests - count - 1;

    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetAt,
      limit: config.maxRequests,
    };
  });

/**
 * Increments rate limit counter for a given userId and HTTP method.
 * Should be called after a successful rate limit check.
 */
const incrementRateLimit = (
  userId: string,
  method: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const config = getRateLimitConfig(method);
    const key = `rate_limit:api:${method.toLowerCase()}:${userId}`;

    // Increment counter and set expiration
    yield* Effect.tryPromise({
      try: () =>
        redis.incr(key).then(() => redis.expire(key, config.windowSeconds)),
      catch: (error) => new Error(`Failed to increment rate limit: ${error}`),
    });
  });

/**
 * Rate limit check for general API endpoints.
 * Tracks requests by userId and HTTP method.
 * Returns rate limit status or fails with RateLimitError containing rate limit info.
 */
export const rateLimitApi = (
  userId: string,
  method: string
): Effect.Effect<
  {
    remaining: number;
    resetAt: number;
    limit: number;
  },
  RateLimitError
> =>
  Effect.gen(function* () {
    // Map Redis errors to allow requests (fail-open) - if Redis is down, don't block users
    const status = yield* checkRateLimit(userId, method).pipe(
      Effect.catchAll(() => {
        const config = getRateLimitConfig(method);
        const now = Math.floor(Date.now() / 1000);
        return Effect.succeed({
          allowed: true,
          remaining: config.maxRequests,
          resetAt: now + config.windowSeconds,
          limit: config.maxRequests,
        });
      })
    );

    if (!status.allowed) {
      // Don't increment counter if already exceeded
      yield* Effect.fail(
        new RateLimitError(
          "Rate limit exceeded",
          status.remaining,
          status.resetAt,
          status.limit
        )
      );
    }

    // Increment counter for allowed request (ignore errors - fail-open)
    yield* incrementRateLimit(userId, method).pipe(
      Effect.catchAll(() => Effect.void)
    );

    return {
      remaining: status.remaining,
      resetAt: status.resetAt,
      limit: status.limit,
    };
  });
