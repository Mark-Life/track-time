import { Effect, Ref } from "effect";
import { getEntries, startTimer, stopTimer } from "./api.ts";
import type { AppRefs } from "./app-state.ts";
import {
  renderEntries,
  showPauseButton,
  showPlayButton,
  showTimerButtonLoading,
} from "./dom.ts";
import { startTimerUI, stopTimerUI } from "./timer-ui.ts";

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
          // Show loading state immediately
          yield* showTimerButtonLoading();

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
            // Restore play button after operation completes
            yield* showPlayButton();
          } else {
            // Timer is stopped, start it
            const selectedProjectId = yield* Ref.get(refs.selectedProjectIdRef);
            const newTimer = yield* startTimer(undefined, selectedProjectId);
            yield* Ref.set(refs.timerRef, newTimer);
            yield* startTimerUI(refs.timerRef, refs.intervalRef);
            // Restore pause button after operation completes
            yield* showPauseButton();
          }
        }),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logError(`Failed to toggle timer: ${error}`);
            // Restore button state on error
            const timer = yield* Ref.get(refs.timerRef);
            if (timer) {
              yield* showPauseButton();
            } else {
              yield* showPlayButton();
            }
          })
      )
    );
  });
};
