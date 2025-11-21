import { Effect, Ref } from "effect";
import type { Timer } from "~/lib/types.ts";
import { getEntries, startTimer, stopTimer } from "./api.ts";
import { renderEntries } from "./dom.ts";
import { startTimerUI, stopTimerUI } from "./timer-ui.ts";
import type { AppRefs } from "./app-state.ts";

/**
 * Sets up play/pause button handler
 */
export const setupTimerButtonHandler = (
  playPauseBtn: HTMLButtonElement,
  refs: AppRefs
) => {
  playPauseBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const timer = yield* Ref.get(refs.timerRef);
          if (timer) {
            // Timer is running, stop it
            const entry = yield* stopTimer;
            yield* stopTimerUI(refs.intervalRef);
            yield* Ref.set(refs.timerRef, null);
            // Reload and render entries to show the new entry (works for both online and offline)
            if (entry) {
              const entries = yield* getEntries;
              const projects = yield* Ref.get(refs.projectsRef);
              yield* renderEntries(entries, projects);
            }
          } else {
            // Timer is stopped, start it
            const selectedProjectId = yield* Ref.get(refs.selectedProjectIdRef);
            const newTimer = yield* startTimer(undefined, selectedProjectId);
            yield* Ref.set(refs.timerRef, newTimer);
            yield* startTimerUI(refs.timerRef, refs.intervalRef);
          }
        }),
        (error) => Effect.logError(`Failed to toggle timer: ${error}`)
        // Could show user-friendly error message here
      )
    );
  });
};

