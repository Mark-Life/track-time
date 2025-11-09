import { Effect, Ref } from "effect";
import { clearLocalTimer, getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Timer } from "~/lib/types.ts";
import { getEntries, getTimer } from "./api.ts";
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

      // Start timer on server (server creates new timer with current time)
      // We keep using local timer in UI to preserve original start time
      yield* Effect.tryPromise({
        try: () => fetch("/api/timer/start", { method: "POST" }),
        catch: () => Effect.void,
      });

      // Keep local timer in ref to preserve start time
      yield* Ref.set(timerRef, localTimer);
      yield* startTimerUI(timerRef, intervalRef);
      // Don't clear local timer yet - it will be cleared when stopped online
    }

    // Reload entries after sync
    const entries = yield* getEntries;
    yield* renderEntries(entries);
  });
