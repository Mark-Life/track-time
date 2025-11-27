import { redis } from "bun";
import { Effect } from "effect";
import { AuthError } from "../types";

/**
 * Rate limit configuration for authentication endpoints.
 */
const RATE_LIMIT_CONFIG = {
  // Maximum attempts allowed per window
  maxAttempts: 5,
  // Window duration in seconds (15 minutes)
  windowSeconds: 15 * 60,
  // Lockout duration in seconds (30 minutes) after max attempts exceeded
  lockoutSeconds: 30 * 60,
} as const;

/**
 * Gets client IP address from request headers.
 * Checks common proxy headers (X-Forwarded-For, X-Real-IP).
 */
const getClientIp = (req: Request): string => {
  // Check X-Forwarded-For header (first IP in chain)
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    if (ips[0]) {
      return ips[0];
    }
  }

  // Check X-Real-IP header
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  // Fallback: try to extract from request URL or use a default
  // In production behind a proxy, this should never be reached
  return "unknown";
};

/**
 * Normalizes email for rate limiting (lowercase, trimmed).
 */
const normalizeEmail = (email: string): string => email.toLowerCase().trim();

/**
 * Checks if rate limit is exceeded for a given identifier.
 * Returns the number of remaining attempts and time until reset.
 */
const checkRateLimit = (
  identifier: string,
  action: "login" | "register"
): Effect.Effect<
  { allowed: boolean; remaining: number; resetAt: number },
  Error
> =>
  Effect.gen(function* () {
    const key = `rate_limit:auth:${action}:${identifier}`;
    const lockoutKey = `rate_limit:auth:${action}:${identifier}:lockout`;

    // Check if account is locked out
    const lockoutUntil: number | null = yield* Effect.tryPromise({
      try: () =>
        redis.get(lockoutKey).then((v) => (v ? Number.parseInt(v, 10) : null)),
      catch: (error) => new Error(`Failed to check lockout: ${error}`),
    });

    const now = Math.floor(Date.now() / 1000);
    if (lockoutUntil && lockoutUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: lockoutUntil,
      };
    }

    // Get current attempt count
    const attemptsStr: string | null = yield* Effect.tryPromise({
      try: () => redis.get(key),
      catch: (error) => new Error(`Failed to get rate limit count: ${error}`),
    });

    const attempts = attemptsStr ? Number.parseInt(attemptsStr, 10) : 0;

    if (attempts >= RATE_LIMIT_CONFIG.maxAttempts) {
      // Set lockout
      const lockoutUntilTime = now + RATE_LIMIT_CONFIG.lockoutSeconds;
      yield* Effect.tryPromise({
        try: () =>
          redis
            .set(lockoutKey, lockoutUntilTime.toString())
            .then(() =>
              redis.expire(lockoutKey, RATE_LIMIT_CONFIG.lockoutSeconds)
            ),
        catch: (error) => new Error(`Failed to set lockout: ${error}`),
      });

      return {
        allowed: false,
        remaining: 0,
        resetAt: lockoutUntilTime,
      };
    }

    const remaining = RATE_LIMIT_CONFIG.maxAttempts - attempts - 1;
    const resetAt = now + RATE_LIMIT_CONFIG.windowSeconds;

    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetAt,
    };
  });

/**
 * Increments rate limit counter for a given identifier.
 * Should be called after a failed authentication attempt.
 */
const incrementRateLimit = (
  identifier: string,
  action: "login" | "register"
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const key = `rate_limit:auth:${action}:${identifier}`;

    // Increment counter and set expiration
    yield* Effect.tryPromise({
      try: () =>
        redis
          .incr(key)
          .then(() => redis.expire(key, RATE_LIMIT_CONFIG.windowSeconds)),
      catch: (error) => new Error(`Failed to increment rate limit: ${error}`),
    });
  });

/**
 * Resets rate limit counter for a given identifier.
 * Should be called after successful authentication.
 */
const resetRateLimit = (
  identifier: string,
  action: "login" | "register"
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const key = `rate_limit:auth:${action}:${identifier}`;
    const lockoutKey = `rate_limit:auth:${action}:${identifier}:lockout`;

    // Remove both counter and lockout
    yield* Effect.tryPromise({
      try: () => Promise.all([redis.del(key), redis.del(lockoutKey)]),
      catch: (error) => new Error(`Failed to reset rate limit: ${error}`),
    });
  });

/**
 * Rate limit middleware for authentication endpoints.
 * Tracks attempts by both IP address and email to prevent:
 * - Brute force from single IP
 * - Credential stuffing targeting specific emails
 */
export const rateLimitAuth = (
  req: Request,
  email: string,
  action: "login" | "register"
): Effect.Effect<void, AuthError> =>
  Effect.gen(function* () {
    const ip = getClientIp(req);
    const normalizedEmail = normalizeEmail(email);

    // Check rate limit by IP
    const ipLimit = yield* checkRateLimit(ip, action);
    if (!ipLimit.allowed) {
      const minutesUntilReset = Math.ceil(
        (ipLimit.resetAt - Math.floor(Date.now() / 1000)) / 60
      );
      return yield* Effect.fail(
        new AuthError(
          `Too many attempts. Please try again in ${minutesUntilReset} minute${
            minutesUntilReset !== 1 ? "s" : ""
          }.`
        )
      );
    }

    // Check rate limit by email (prevents credential stuffing)
    const emailLimit = yield* checkRateLimit(normalizedEmail, action);
    if (!emailLimit.allowed) {
      const minutesUntilReset = Math.ceil(
        (emailLimit.resetAt - Math.floor(Date.now() / 1000)) / 60
      );
      return yield* Effect.fail(
        new AuthError(
          `Too many attempts for this email. Please try again in ${minutesUntilReset} minute${
            minutesUntilReset !== 1 ? "s" : ""
          }.`
        )
      );
    }
  });

/**
 * Records a failed authentication attempt.
 * Should be called when authentication fails.
 */
export const recordFailedAttempt = (
  req: Request,
  email: string,
  action: "login" | "register"
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const ip = getClientIp(req);
    const normalizedEmail = normalizeEmail(email);

    // Increment counters for both IP and email
    yield* incrementRateLimit(ip, action);
    yield* incrementRateLimit(normalizedEmail, action);
  });

/**
 * Records a successful authentication attempt.
 * Resets rate limit counters to allow normal usage.
 */
export const recordSuccess = (
  req: Request,
  email: string,
  action: "login" | "register"
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const ip = getClientIp(req);
    const normalizedEmail = normalizeEmail(email);

    // Reset counters for both IP and email
    yield* resetRateLimit(ip, action);
    yield* resetRateLimit(normalizedEmail, action);
  });
