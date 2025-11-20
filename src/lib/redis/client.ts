import { redis } from "bun";
import { Effect } from "effect";

// Redis connection resource - verifies connection before use
const connectRedis = Effect.gen(function* () {
  // Connect (idempotent - safe to call multiple times)
  redis.connect();

  // Verify connection with PING
  yield* Effect.tryPromise({
    try: () => redis.ping(),
    catch: (error) => new Error(`Failed to connect to Redis: ${error}`),
  });

  yield* Effect.log("✅ Redis connection established");

  return redis;
});

export const redisResource = Effect.acquireRelease(connectRedis, () =>
  Effect.sync(() => {
    // Cleanup if needed (Bun manages connection lifecycle)
  })
);
