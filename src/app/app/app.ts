import "~/global.css";
import { Effect, Ref } from "effect";
import { getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Timer, WebSocketMessage } from "~/lib/types.ts";
import {
  deleteEntry,
  getEntries,
  getTimer,
  startTimer,
  stopTimer,
} from "./api.ts";
import { addEntryToList, renderEntries, showPlayButton } from "./dom.ts";
import { entriesList, playPauseBtn } from "./dom-elements.ts";
import {
  hideOfflineIndicator,
  showOfflineIndicator,
} from "./offline-indicator.ts";
import { syncWithServer } from "./sync.ts";
import { startTimerUI, stopTimerUI } from "./timer-ui.ts";

// Accept HMR updates
if (import.meta.hot) {
  import.meta.hot.accept();
}

// Main app initialization
const initializeApp = Effect.gen(function* () {
  const timerRef = yield* Ref.make<Timer | null>(null);
  const intervalRef = yield* Ref.make<number | null>(null);

  // Load initial data
  const loadInitialData = Effect.gen(function* () {
    // Check localStorage first for offline timer
    const localTimer = yield* getTimerFromLocal();
    if (localTimer && !navigator.onLine) {
      yield* Ref.set(timerRef, localTimer);
      yield* startTimerUI(timerRef, intervalRef);
    } else {
      const timer = yield* getTimer;
      if (timer) {
        yield* Ref.set(timerRef, timer);
        yield* startTimerUI(timerRef, intervalRef);
      } else {
        // No timer active, show play button
        yield* showPlayButton();
      }
    }

    const entries = yield* getEntries;
    yield* renderEntries(entries);
  });

  // Set up online/offline listeners
  const updateOnlineStatus = () =>
    Effect.gen(function* () {
      if (navigator.onLine) {
        yield* hideOfflineIndicator;
        // Attempt sync when coming back online
        yield* syncWithServer(timerRef, intervalRef);
      } else {
        yield* showOfflineIndicator;
      }
    });

  // Initial online status
  Effect.runPromise(
    Effect.catchAll(updateOnlineStatus(), (error) =>
      Effect.logError(`Failed to update online status: ${error}`)
    )
  );

  // Listen for online/offline events
  window.addEventListener("online", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle online event: ${error}`)
      )
    );
  });

  window.addEventListener("offline", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle offline event: ${error}`)
      )
    );
  });

  // WebSocket connection
  const ws = new WebSocket(`ws://${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected"));
    Effect.runPromise(
      Effect.catchAll(loadInitialData, (error) =>
        Effect.logError(`Failed to load initial data: ${error}`)
      )
    );
  };

  ws.onmessage = (event) => {
    let message: WebSocketMessage;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      Effect.runPromise(
        Effect.logError(`Failed to parse WebSocket message: ${error}`)
      );
      return;
    }

    if (message.type === "timer:started") {
      const startedAt = message.data.startedAt;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* Ref.set(timerRef, { startedAt });
            yield* startTimerUI(timerRef, intervalRef);
          }),
          (error) => Effect.logError(`Failed to handle timer:started: ${error}`)
        )
      );
    } else if (message.type === "timer:stopped") {
      const entry = message.data.entry;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* stopTimerUI(intervalRef);
            yield* Ref.set(timerRef, null);
            yield* addEntryToList(entry);
          }),
          (error) => Effect.logError(`Failed to handle timer:stopped: ${error}`)
        )
      );
    }
  };

  ws.onerror = (error) => {
    Effect.runPromise(Effect.logError(`WebSocket error: ${error}`));
  };

  ws.onclose = () => {
    Effect.runPromise(Effect.log("WebSocket disconnected"));
  };

  // Button handler - toggle play/pause based on timer state
  playPauseBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const timer = yield* Ref.get(timerRef);
          if (timer) {
            // Timer is running, stop it
            const entry = yield* stopTimer;
            yield* stopTimerUI(intervalRef);
            yield* Ref.set(timerRef, null);
            // Reload and render entries to show the new entry (works for both online and offline)
            if (entry) {
              const entries = yield* getEntries;
              yield* renderEntries(entries);
            }
          } else {
            // Timer is stopped, start it
            const newTimer = yield* startTimer;
            yield* Ref.set(timerRef, newTimer);
            yield* startTimerUI(timerRef, intervalRef);
          }
        }),
        (error) => Effect.logError(`Failed to toggle timer: ${error}`)
        // Could show user-friendly error message here
      )
    );
  });

  // Delete entry handler (event delegation)
  entriesList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const deleteBtn = target.closest(".delete-entry-btn") as HTMLButtonElement;
    if (!deleteBtn) {
      return;
    }

    const entryId = deleteBtn.getAttribute("data-entry-id");
    if (!entryId) {
      return;
    }

    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          yield* deleteEntry(entryId);
          const entries = yield* getEntries;
          yield* renderEntries(entries);
        }),
        (error) => Effect.logError(`Failed to delete entry: ${error}`)
      )
    );
  });
});

// Run the app
Effect.runPromise(
  Effect.catchAll(initializeApp, (error) =>
    Effect.logError(`Failed to initialize app: ${error}`)
  )
);
