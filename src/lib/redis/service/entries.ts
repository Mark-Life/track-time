import { redis } from "bun";
import { Effect } from "effect";
import type { Entry } from "~/lib/types.ts";

/**
 * Get all entries
 */
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

    // Fetch all entries in parallel
    const entryPromises = ids.map((id) =>
      Effect.tryPromise({
        try: () => redis.hgetall(`entry:${id}`),
        catch: (error) => new Error(`Failed to get entry ${id}: ${error}`),
      })
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

    // Sort by startedAt descending (newest first)
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
export const updateEntry = (
  id: string,
  startedAt: string,
  endedAt: string,
  projectId?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    // Check if entry exists
    const exists: boolean = yield* Effect.tryPromise({
      try: () => redis.sismember("entries:list", id),
      catch: (error) => new Error(`Failed to check if entry exists: ${error}`),
    });

    if (!exists) {
      yield* Effect.fail(new Error(`Entry with id ${id} not found`));
    }

    // Validate date formats
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);

    if (Number.isNaN(startedAtDate.getTime())) {
      yield* Effect.fail(
        new Error("Invalid startedAt format. Expected ISO string.")
      );
    }

    if (Number.isNaN(endedAtDate.getTime())) {
      yield* Effect.fail(
        new Error("Invalid endedAt format. Expected ISO string.")
      );
    }

    const startTime = startedAtDate.getTime();
    const endTime = endedAtDate.getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    if (duration < 0) {
      yield* Effect.fail(new Error("End time must be after start time"));
    }

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
      // Remove projectId if it was set before but is now being removed
      yield* Effect.tryPromise({
        try: () => redis.hdel(`entry:${id}`, "projectId"),
        catch: (error) =>
          new Error(`Failed to remove projectId from entry: ${error}`),
      });
    }

    yield* Effect.tryPromise({
      try: () => redis.hset(`entry:${id}`, entryData),
      catch: (error) => new Error(`Failed to update entry: ${error}`),
    });

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
export const deleteEntry = (id: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => redis.del(`entry:${id}`),
      catch: (error) => new Error(`Failed to delete entry hash: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.srem("entries:list", id),
      catch: (error) => new Error(`Failed to remove entry from list: ${error}`),
    });

    yield* Effect.log(`🗑️  Deleted entry ${id}`);
  });
