import { Effect } from "effect";
import type { Entry, Timer } from "~/lib/types.ts";
import { validateEntryDuration } from "~/lib/entry-validation.ts";
import { Redis } from "../client.ts";

const userKey = (userId: string, key: string): string =>
  `user:${userId}:${key}`;

/**
 * Get active timer
 */
export const getActiveTimer = (
  userId: string
): Effect.Effect<Timer | null, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    const startedAt: string | null = yield* redis.hget(
      userKey(userId, "active:timer"),
      "startedAt"
    );

    if (!startedAt) {
      return null;
    }

    const projectId: string | null = yield* redis.hget(
      userKey(userId, "active:timer"),
      "projectId"
    );

    return {
      startedAt: startedAt as string,
      ...(projectId ? { projectId } : {}),
    };
  });

/**
 * Start timer
 */
export const startTimer = (
  userId: string,
  startedAt?: string,
  projectId?: string
): Effect.Effect<Timer, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const timerStartedAt = startedAt ?? new Date().toISOString();

    const timerData: Record<string, string> = {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };

    yield* redis.hset(userKey(userId, "active:timer"), timerData);

    yield* Effect.log(`⏱️  Timer started at ${timerStartedAt}`);

    return {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };
  });

/**
 * Update timer project
 */
export const updateTimerProject = (
  userId: string,
  projectId?: string
): Effect.Effect<Timer, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const timer: Timer | null = yield* getActiveTimer(userId);
    if (!timer) {
      return yield* Effect.fail(new Error("No active timer"));
    }

    const timerData: Record<string, string> = {
      startedAt: timer.startedAt,
      ...(projectId ? { projectId } : {}),
    };

    yield* redis.hset(userKey(userId, "active:timer"), timerData);

    yield* Effect.log(
      `🔄 Timer project updated${projectId ? ` to ${projectId}` : " (removed)"}`
    );

    return {
      startedAt: timer.startedAt,
      ...(projectId ? { projectId } : {}),
    };
  });

/**
 * Stop timer and save entry
 */
export const stopTimer = (
  userId: string
): Effect.Effect<Entry | null, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const timer: Timer | null = yield* getActiveTimer(userId);
    if (!timer) {
      return null;
    }

    const endedAt = new Date().toISOString();
    yield* validateEntryDuration(timer.startedAt, endedAt);

    const startTime = new Date(timer.startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    const id = crypto.randomUUID();
    const entry: Entry = {
      id,
      startedAt: timer.startedAt,
      endedAt,
      duration,
      ...(timer.projectId ? { projectId: timer.projectId } : {}),
    };

    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    yield* redis.hset(userKey(userId, `entry:${id}`), entryData);
    yield* redis.sadd(userKey(userId, "entries:list"), id);
    yield* redis.del(userKey(userId, "active:timer"));

    yield* Effect.log("✅ Timer stopped - Entry created:");
    yield* Effect.log(`   ID: ${entry.id}`);
    yield* Effect.log(`   Started: ${entry.startedAt}`);
    yield* Effect.log(`   Ended: ${entry.endedAt}`);
    yield* Effect.log(
      `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
    );

    return entry;
  });
