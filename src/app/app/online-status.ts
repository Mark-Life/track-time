import { Effect, type Ref } from "effect";
import type { Timer } from "~/lib/types.ts";
import {
  hideOfflineIndicator,
  showOfflineIndicator,
} from "./offline-indicator.ts";
import { syncWithServer } from "./sync.ts";

/**
 * Updates online/offline status and syncs when coming back online
 */
export const updateOnlineStatus = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) =>
  Effect.gen(function* () {
    if (navigator.onLine) {
      yield* hideOfflineIndicator;
      // Attempt sync when coming back online
      yield* syncWithServer(timerRef, intervalRef);
    } else {
      yield* showOfflineIndicator;
    }
  });

/**
 * Sets up online/offline event listeners
 */
export const setupOnlineStatusListeners = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) => {
  // Initial online status
  Effect.runPromise(
    Effect.catchAll(updateOnlineStatus(timerRef, intervalRef), (error) =>
      Effect.logError(`Failed to update online status: ${error}`)
    )
  );

  // Listen for online/offline events
  window.addEventListener("online", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(timerRef, intervalRef), (error) =>
        Effect.logError(`Failed to handle online event: ${error}`)
      )
    );
  });

  window.addEventListener("offline", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(timerRef, intervalRef), (error) =>
        Effect.logError(`Failed to handle offline event: ${error}`)
      )
    );
  });
};
