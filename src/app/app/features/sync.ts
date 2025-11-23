import { Effect, Ref } from "effect";
import { CacheKeys, getCached } from "~/lib/cache.ts";
import {
  clearLocalTimer,
  clearSyncedEntry,
  getLocalEntries,
  getTimerFromLocal,
} from "~/lib/local-storage.ts";
import type { Entry, Timer } from "~/lib/types.ts";
import {
  createEntry,
  getEntries,
  getProjects,
  getTimer,
  startTimer,
} from "../api.ts";
import { renderEntries } from "../ui/dom.ts";
import { startTimerUI } from "../ui/timer-ui.ts";

export const syncWithServer = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      return;
    }

    const localTimer = yield* getTimerFromLocal();

    // Sync timer if exists locally
    if (localTimer) {
      // Check if server has a timer
      const serverTimer = yield* getTimer;
      if (serverTimer) {
        // If server timer exists and is different, stop it first
        if (serverTimer.startedAt !== localTimer.startedAt) {
          yield* Effect.tryPromise({
            try: () => fetch("/api/timer/stop", { method: "POST" }),
            catch: () => Effect.void,
          });
        } else {
          // Same timer, already synced
          yield* clearLocalTimer();
          return;
        }
      }

      // Start timer on server with local timer's startedAt and projectId to preserve original values
      const syncedTimer = yield* startTimer(
        localTimer.startedAt,
        localTimer.projectId
      );
      yield* clearLocalTimer();

      // Use synced timer in ref (should match local timer's startedAt)
      yield* Ref.set(timerRef, syncedTimer);
      yield* startTimerUI(timerRef, intervalRef);
    }

    // Sync offline entries to server
    const localEntries = yield* getLocalEntries();
    const cachedServerEntries = yield* getCached<Entry[]>(CacheKeys.entries);
    const serverIds = new Set((cachedServerEntries ?? []).map((e) => e.id));
    const unsyncedEntries = localEntries.filter((e) => !serverIds.has(e.id));

    // Sync each unsynced entry
    for (const localEntry of unsyncedEntries) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          // Create entry on server
          yield* createEntry(
            localEntry.startedAt,
            localEntry.endedAt,
            localEntry.projectId
          );
          // Remove old local entry after successful sync
          yield* clearSyncedEntry(localEntry.id);
        }),
        (error) =>
          Effect.gen(function* () {
            // Log error but continue syncing other entries
            yield* Effect.logError(
              `Failed to sync entry ${localEntry.id}: ${error}`
            );
          })
      );
    }

    // Reload entries after sync
    const entries = yield* getEntries;
    const projects = yield* getProjects;
    yield* renderEntries(entries, projects);
  });
