import { Effect, Ref } from "effect";
import { clearLocalTimer, getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Timer } from "~/lib/types.ts";
import { getEntries, getProjects, getTimer, startTimer } from "./api.ts";
import { renderEntries } from "./dom.ts";
import { startTimerUI } from "./timer-ui.ts";

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

    // Reload entries after sync
    const entries = yield* getEntries;
    const projects = yield* getProjects;
    yield* renderEntries(entries, projects);
  });
