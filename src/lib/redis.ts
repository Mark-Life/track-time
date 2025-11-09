import { redis } from "bun";
import { Effect } from "effect";
import type { Entry, Timer } from "./types.ts";

// Initialize Redis connection
redis.connect();

// Get active timer
export const getActiveTimer = (): Effect.Effect<Timer | null, Error> =>
  Effect.gen(function* () {
    const startedAt: string | null = yield* Effect.tryPromise({
      try: () => redis.hget("active:timer", "startedAt"),
      catch: (error) => new Error(`Failed to get active timer: ${error}`),
    });

    if (!startedAt) {
      return null;
    }
    return { startedAt: startedAt as string };
  });

// Start timer
export const startTimer = (): Effect.Effect<Timer, Error> =>
  Effect.gen(function* () {
    const startedAt = new Date().toISOString();

    yield* Effect.tryPromise({
      try: () => redis.hset("active:timer", "startedAt", startedAt),
      catch: (error) => new Error(`Failed to start timer: ${error}`),
    });

    yield* Effect.log(`⏱️  Timer started at ${startedAt}`);

    return { startedAt };
  });

// Stop timer and save entry
export const stopTimer = (): Effect.Effect<Entry | null, Error> =>
  Effect.gen(function* () {
    const timer: Timer | null = yield* getActiveTimer();
    if (!timer) {
      return null;
    }

    const endedAt = new Date().toISOString();
    const startTime = new Date(timer.startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60); // hours in decimal

    const id = crypto.randomUUID();
    const entry: Entry = {
      id,
      startedAt: timer.startedAt,
      endedAt,
      duration,
    };

    // Save entry to Redis
    yield* Effect.tryPromise({
      try: () =>
        redis.hset(`entry:${id}`, {
          id,
          startedAt: entry.startedAt,
          endedAt: entry.endedAt,
          duration: entry.duration.toString(),
        }),
      catch: (error) => new Error(`Failed to save entry: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd("entries:list", id),
      catch: (error) => new Error(`Failed to add entry to list: ${error}`),
    });

    // Remove active timer
    yield* Effect.tryPromise({
      try: () => redis.del("active:timer"),
      catch: (error) => new Error(`Failed to delete active timer: ${error}`),
    });

    yield* Effect.log("✅ Timer stopped - Entry created:");
    yield* Effect.log(`   ID: ${entry.id}`);
    yield* Effect.log(`   Started: ${entry.startedAt}`);
    yield* Effect.log(`   Ended: ${entry.endedAt}`);
    yield* Effect.log(
      `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
    );

    return entry;
  });

// Get all entries
export const getEntries = (): Effect.Effect<Entry[], Error> =>
  Effect.gen(function* () {
    const ids: string[] = yield* Effect.tryPromise({
      try: () => redis.smembers("entries:list"),
      catch: (error) => new Error(`Failed to get entry IDs: ${error}`),
    });

    if (!ids || ids.length === 0) {
      yield* Effect.log("📋 No entries found");
      return [];
    }

    const entries: Entry[] = [];
    for (const id of ids) {
      const data: Record<string, string> | null = yield* Effect.tryPromise({
        try: () => redis.hgetall(`entry:${id}`),
        catch: (error) => new Error(`Failed to get entry ${id}: ${error}`),
      });

      if (data) {
        const entryData = data as {
          id: string;
          startedAt: string;
          endedAt: string;
          duration: string;
        };
        entries.push({
          id: entryData.id,
          startedAt: entryData.startedAt,
          endedAt: entryData.endedAt,
          duration: Number.parseFloat(entryData.duration),
        });
      }
    }

    // Sort by startedAt descending (newest first)
    const sorted = entries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    yield* Effect.log(`📋 Loaded ${sorted.length} entries from Redis`);

    return sorted;
  });
