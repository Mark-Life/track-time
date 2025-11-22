import { Effect } from "effect";
import type { Entry } from "~/lib/types.ts";
import { validateEntryDuration } from "~/lib/entry-validation.ts";
import { Redis } from "../client.ts";

const userKey = (userId: string, key: string): string =>
  `user:${userId}:${key}`;

/**
 * Get all entries
 */
export const getEntries = (
  userId: string
): Effect.Effect<Entry[], Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    const ids: string[] = yield* redis.smembers(
      userKey(userId, "entries:list")
    );

    if (!ids || ids.length === 0) {
      yield* Effect.log("📋 No entries found");
      return [];
    }

    const entryPromises = ids.map((id) =>
      redis.hgetall(userKey(userId, `entry:${id}`))
    );

    const entryDataArray = yield* Effect.all(entryPromises, {
      concurrency: "unbounded",
    });

    const entries: Entry[] = [];
    for (const data of entryDataArray) {
      if (data) {
        const entryData = data as {
          id: string;
          startedAt: string;
          endedAt: string;
          duration: string;
          projectId?: string;
        };
        entries.push({
          id: entryData.id,
          startedAt: entryData.startedAt,
          endedAt: entryData.endedAt,
          duration: Number.parseFloat(entryData.duration),
          ...(entryData.projectId ? { projectId: entryData.projectId } : {}),
        });
      }
    }

    const sorted = entries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    yield* Effect.log(`📋 Loaded ${sorted.length} entries from Redis`);

    return sorted;
  });

/**
 * Update entry
 */
export const updateEntry = ({
  userId,
  id,
  startedAt,
  endedAt,
  projectId,
}: {
  userId: string;
  id: string;
  startedAt: string;
  endedAt: string;
  projectId?: string;
}): Effect.Effect<Entry, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    const exists: boolean = yield* redis.sismember(
      userKey(userId, "entries:list"),
      id
    );

    if (!exists) {
      yield* Effect.fail(new Error(`Entry with id ${id} not found`));
    }

    yield* validateEntryDuration(startedAt, endedAt);

    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);
    const startTime = startedAtDate.getTime();
    const endTime = endedAtDate.getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    const entry: Entry = {
      id,
      startedAt,
      endedAt,
      duration,
      ...(projectId ? { projectId } : {}),
    };

    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    if (!entry.projectId) {
      yield* redis.hdel(userKey(userId, `entry:${id}`), "projectId");
    }

    yield* redis.hset(userKey(userId, `entry:${id}`), entryData);

    yield* Effect.log(`✏️  Updated entry ${id}`);
    yield* Effect.log(`   Started: ${entry.startedAt}`);
    yield* Effect.log(`   Ended: ${entry.endedAt}`);
    yield* Effect.log(
      `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
    );

    return entry;
  });

/**
 * Delete entry
 */
export const deleteEntry = (
  userId: string,
  id: string
): Effect.Effect<void, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    yield* redis.del(userKey(userId, `entry:${id}`));
    yield* redis.srem(userKey(userId, "entries:list"), id);

    yield* Effect.log(`🗑️  Deleted entry ${id}`);
  });
