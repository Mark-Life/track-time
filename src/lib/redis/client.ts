import { redis } from "bun";
import { Effect } from "effect";

/**
 * Redis service interface
 */
export class Redis extends Effect.Service<Redis>()("Redis", {
  accessors: true,
  scoped: Effect.gen(function* () {
    // Connect (idempotent - safe to call multiple times)
    redis.connect();

    // Verify connection with PING
    yield* Effect.promise(() => redis.ping()).pipe(
      Effect.mapError(
        (error) => new Error(`Failed to connect to Redis: ${error}`)
      )
    );

    yield* Effect.log("✅ Redis connection established");

    // Return Redis client wrapper with typed operations
    return {
      /**
       * Get value from hash field
       */
      hget: (key: string, field: string) =>
        Effect.promise(() => redis.hget(key, field)).pipe(
          Effect.mapError((error) => new Error(`Redis hget failed: ${error}`))
        ),

      /**
       * Get all fields and values from hash
       */
      hgetall: (key: string) =>
        Effect.promise(() => redis.hgetall(key)).pipe(
          Effect.mapError(
            (error) => new Error(`Redis hgetall failed: ${error}`)
          )
        ),

      /**
       * Set hash field
       */
      hset: (key: string, data: Record<string, string>) =>
        Effect.promise(() => redis.hset(key, data)).pipe(
          Effect.mapError((error) => new Error(`Redis hset failed: ${error}`))
        ),

      /**
       * Delete hash field
       */
      hdel: (key: string, field: string) =>
        Effect.promise(() => redis.hdel(key, field)).pipe(
          Effect.mapError((error) => new Error(`Redis hdel failed: ${error}`))
        ),

      /**
       * Get all members of a set
       */
      smembers: (key: string) =>
        Effect.promise(() => redis.smembers(key)).pipe(
          Effect.mapError(
            (error) => new Error(`Redis smembers failed: ${error}`)
          )
        ),

      /**
       * Add member to set
       */
      sadd: (key: string, member: string) =>
        Effect.promise(() => redis.sadd(key, member)).pipe(
          Effect.mapError((error) => new Error(`Redis sadd failed: ${error}`))
        ),

      /**
       * Remove member from set
       */
      srem: (key: string, member: string) =>
        Effect.promise(() => redis.srem(key, member)).pipe(
          Effect.mapError((error) => new Error(`Redis srem failed: ${error}`))
        ),

      /**
       * Check if member exists in set
       */
      sismember: (key: string, member: string) =>
        Effect.promise(() => redis.sismember(key, member)).pipe(
          Effect.mapError(
            (error) => new Error(`Redis sismember failed: ${error}`)
          )
        ),

      /**
       * Delete key
       */
      del: (key: string) =>
        Effect.promise(() => redis.del(key)).pipe(
          Effect.mapError((error) => new Error(`Redis del failed: ${error}`))
        ),

      /**
       * Ping Redis server
       */
      ping: () =>
        Effect.promise(() => redis.ping()).pipe(
          Effect.mapError((error) => new Error(`Redis ping failed: ${error}`))
        ),
    };
  }),
}) {}

// Export the default layer for convenience
export const RedisLive = Redis.Default;
