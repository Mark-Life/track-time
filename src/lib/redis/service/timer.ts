import { redis } from "bun";
import { Effect } from "effect";
import type { Entry, Timer } from "~/lib/types.ts";

/**
 * Get active timer
 */
export const getActiveTimer = (): Effect.Effect<Timer | null, Error> =>
  Effect.gen(function* () {
    const startedAt: string | null = yield* Effect.tryPromise({
      try: () => redis.hget("active:timer", "startedAt"),
      catch: (error) => new Error(`Failed to get active timer: ${error}`),
    });

    if (!startedAt) {
      return null;
    }

    const projectId: string | null = yield* Effect.tryPromise({
      try: () => redis.hget("active:timer", "projectId"),
      catch: (error) => new Error(`Failed to get timer projectId: ${error}`),
    });

    return {
      startedAt: startedAt as string,
      ...(projectId ? { projectId } : {}),
    };
  });

/**
 * Start timer
 */
export const startTimer = (
  startedAt?: string,
  projectId?: string
): Effect.Effect<Timer, Error> =>
  Effect.gen(function* () {
    const timerStartedAt = startedAt ?? new Date().toISOString();

    const timerData: Record<string, string> = {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };

    yield* Effect.tryPromise({
      try: () => redis.hset("active:timer", timerData),
      catch: (error) => new Error(`Failed to start timer: ${error}`),
    });

    yield* Effect.log(`⏱️  Timer started at ${timerStartedAt}`);

    return {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };
  });

/**
 * Stop timer and save entry
 */
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
      ...(timer.projectId ? { projectId: timer.projectId } : {}),
    };

    // Save entry to Redis
    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    yield* Effect.tryPromise({
      try: () => redis.hset(`entry:${id}`, entryData),
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
