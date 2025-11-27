import { Effect, Ref } from "effect";
import type { Entry, Project, Timer } from "~/lib/types.ts";
import { getEntries, startTimer, stopTimer } from "../api.ts";
import type { AppRefs } from "../core/app-state.ts";
import {
  renderEntries,
  showPauseButton,
  showPlayButton,
  showTimerButtonLoading,
} from "../ui/dom.ts";
import { startTimerUI, stopTimerUI } from "../ui/timer-ui.ts";

/**
 * Ensures the newly created entry is included in entries list when offline
 */
const ensureEntryInList = (entries: Entry[], newEntry: Entry): Entry[] => {
  if (navigator.onLine) {
    return entries;
  }
  const entryExists = entries.some((e) => e.id === newEntry.id);
  const updatedEntries = entryExists ? entries : [newEntry, ...entries];
  // Sort by start time (newest first)
  return updatedEntries.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
};

/**
 * Handles stopping the timer
 */
const handleStopTimer = (refs: AppRefs) =>
  Effect.gen(function* () {
    const entry = yield* stopTimer;
    yield* stopTimerUI(refs.intervalRef);
    yield* Ref.set(refs.timerRef, null);
    // Reload and render entries to show the new entry (works for both online and offline)
    if (entry) {
      const entries = yield* getEntries;
      const updatedEntries = ensureEntryInList(entries, entry);
      const projects: Project[] = yield* Ref.get(refs.projectsRef);
      yield* renderEntries(updatedEntries, projects);
    }
    yield* showPlayButton();
  });

/**
 * Handles starting the timer
 */
const handleStartTimer = (refs: AppRefs) =>
  Effect.gen(function* () {
    const selectedProjectId: string | undefined = yield* Ref.get(
      refs.selectedProjectIdRef
    );
    const newTimer: Timer = yield* startTimer(undefined, selectedProjectId);
    yield* Ref.set(refs.timerRef, newTimer);
    yield* startTimerUI(refs.timerRef, refs.intervalRef);
    yield* showPauseButton();
  });

/**
 * Toggles timer (play/pause)
 */
const toggleTimer = (refs: AppRefs) => {
  Effect.runPromise(
    Effect.catchAll(
      Effect.gen(function* () {
        yield* showTimerButtonLoading();
        const timer = yield* Ref.get(refs.timerRef);
        if (timer) {
          yield* handleStopTimer(refs);
        } else {
          yield* handleStartTimer(refs);
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
};

/**
 * Sets up play/pause button handler and keyboard shortcuts
 */
export const setupTimerButtonHandler = (
  playPauseBtn: HTMLButtonElement,
  refs: AppRefs
) => {
  // Click handler
  playPauseBtn.addEventListener("click", () => {
    toggleTimer(refs);
  });

  // Space key handler for play/pause (only when not in input/textarea)
  const handleSpaceKey = (event: KeyboardEvent) => {
    if (event.key !== " " || event.repeat) {
      return;
    }

    // Don't trigger if user is typing in an input or textarea
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA")
    ) {
      return;
    }

    // Don't trigger if a modal is open
    const calendarModal = document.getElementById("calendar-entry-modal");
    const deleteModal = document.getElementById("delete-modal");
    if (
      (calendarModal && !calendarModal.classList.contains("hidden")) ||
      (deleteModal && !deleteModal.classList.contains("hidden"))
    ) {
      return;
    }

    event.preventDefault();
    toggleTimer(refs);
  };

  document.addEventListener("keydown", handleSpaceKey);
};
