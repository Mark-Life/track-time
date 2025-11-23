import { Effect, Ref } from "effect";
import type { Entry, Project } from "~/lib/types.ts";
import { calendarEntriesContainer } from "../../ui/dom-elements.ts";
import {
  getTimeFromPosition,
  roundToNearest5Minutes,
} from "./calendar-utils.ts";
import { renderSelectionIndicator, clearSelectionIndicator } from "./calendar-selection.ts";
import { renderEntryEditFormInModal } from "./calendar-modal.ts";

/**
 * Handles edit button click
 */
const handleEditClick = (
  entryId: string,
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): void => {
  Effect.runPromise(
    Effect.catchAll(
      Effect.gen(function* () {
        const entries: Entry[] = yield* Ref.get(entriesRef);
        const projects: Project[] = yield* Ref.get(projectsRef);
        const entry = entries.find((e: Entry) => e.id === entryId);
        if (entry) {
          yield* renderEntryEditFormInModal(entry, projects);
        }
      }),
      (error) => Effect.logError(`Failed to show edit form: ${error}`)
    )
  );
};

/**
 * Handles entry block click (edit)
 */
const handleEntryBlockClick = (
  entryId: string,
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): void => {
  if (entryId.startsWith("temp-")) {
    return;
  }
  handleEditClick(entryId, entriesRef, projectsRef);
};

/**
 * Handles empty time slot click (create new entry)
 */
const handleEmptySlotClick = (
  projectsRef: Ref.Ref<Project[]>,
  startTime?: Date,
  endTime?: Date
): void => {
  const defaultStartTime = startTime ?? new Date();
  const defaultEndTime =
    endTime ??
    (() => {
      const end = new Date(defaultStartTime);
      end.setHours(end.getHours() + 1); // Default 1 hour duration
      return end;
    })();

  // Round times to 5-minute intervals
  const roundedStartTime = roundToNearest5Minutes(defaultStartTime);
  const roundedEndTime = roundToNearest5Minutes(defaultEndTime);

  // Ensure start <= end (swap if needed)
  const actualStart =
    roundedStartTime <= roundedEndTime ? roundedStartTime : roundedEndTime;
  const actualEnd =
    roundedStartTime <= roundedEndTime ? roundedEndTime : roundedStartTime;

  // Calculate duration in hours
  const duration =
    (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60 * 60);

  Effect.runPromise(
    Effect.catchAll(
      Effect.gen(function* () {
        const projects: Project[] = yield* Ref.get(projectsRef);
        // Create a temporary entry for editing
        const tempEntry: Entry = {
          id: "temp-new",
          startedAt: actualStart.toISOString(),
          endedAt: actualEnd.toISOString(),
          duration,
        };
        yield* renderEntryEditFormInModal(tempEntry, projects);
      }),
      (error) => Effect.logError(`Failed to create entry form: ${error}`)
    )
  );
};

/**
 * Checks if drag should start based on the target element
 */
const shouldStartDrag = (target: HTMLElement): boolean => {
  // Don't start drag on entry blocks
  if (target.closest("[data-entry-id]")) {
    return false;
  }

  // Don't start drag on buttons or interactive elements
  if (
    target.closest("button") ||
    target.closest("input") ||
    target.closest("form")
  ) {
    return false;
  }

  return true;
};

/**
 * Handles click/tap on entry block
 */
const handleEntryClick = (
  target: HTMLElement,
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): void => {
  const entryBlock = target.closest("[data-entry-id]");
  if (entryBlock) {
    const entryId = entryBlock.getAttribute("data-entry-id");
    if (entryId) {
      handleEntryBlockClick(entryId, entriesRef, projectsRef);
    }
  }
};

/**
 * Sets up drag and click handlers for the calendar
 */
export const setupCalendarClickHandlers = (
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Create drag state refs
    const isDraggingRef = yield* Ref.make(false);
    const dragStartTimeRef = yield* Ref.make<Date | null>(null);
    const dragStartYRef = yield* Ref.make<number | null>(null);
    const dragThreshold = 5; // pixels

    const handleDragStart = (clientY: number): void => {
      Effect.runPromise(
        Effect.gen(function* () {
          const startTime = getTimeFromPosition(
            clientY,
            calendarEntriesContainer
          );
          yield* Ref.set(isDraggingRef, true);
          yield* Ref.set(dragStartTimeRef, startTime);
          yield* Ref.set(dragStartYRef, clientY);
        })
      );
    };

    const handleDragMove = (clientY: number): void => {
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (!isDragging) {
            return;
          }

          const startTime = yield* Ref.get(dragStartTimeRef);
          if (!startTime) {
            return;
          }

          const endTime = getTimeFromPosition(
            clientY,
            calendarEntriesContainer
          );
          yield* renderSelectionIndicator(
            startTime,
            endTime,
            calendarEntriesContainer
          );
        })
      );
    };

    const handleDragEnd = (clientY: number): void => {
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (!isDragging) {
            return;
          }

          const startY = yield* Ref.get(dragStartYRef);
          const startTime = yield* Ref.get(dragStartTimeRef);

          // Clear drag state
          yield* Ref.set(isDraggingRef, false);
          yield* Ref.set(dragStartTimeRef, null);
          yield* Ref.set(dragStartYRef, null);

          // Clear selection indicator
          yield* clearSelectionIndicator(calendarEntriesContainer);

          if (!startTime || startY === null) {
            return;
          }

          // Check if this was a drag (movement > threshold) or a click
          const dragDistance = Math.abs(clientY - startY);
          if (dragDistance < dragThreshold) {
            return;
          }

          // It was a drag - create entry with selected range
          const endTime = getTimeFromPosition(
            clientY,
            calendarEntriesContainer
          );
          handleEmptySlotClick(projectsRef, startTime, endTime);
        })
      );
    };

    // Mouse events
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      if (!shouldStartDrag(target)) {
        return;
      }
      event.preventDefault();
      handleDragStart(event.clientY);
    };

    const handleMouseMove = (event: MouseEvent): void => {
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (isDragging) {
            event.preventDefault();
            handleDragMove(event.clientY);
          }
        })
      );
    };

    const handleMouseUp = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (!isDragging) {
            handleEntryClick(target, entriesRef, projectsRef);
            return;
          }
          handleDragEnd(event.clientY);
        })
      );
    };

    // Touch events
    const handleTouchStart = (event: TouchEvent): void => {
      const target = event.target as HTMLElement;
      if (!shouldStartDrag(target)) {
        return;
      }
      const touch = event.touches[0];
      if (touch) {
        event.preventDefault();
        handleDragStart(touch.clientY);
      }
    };

    const handleTouchMove = (event: TouchEvent): void => {
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (isDragging) {
            event.preventDefault();
            const touch = event.touches[0];
            if (touch) {
              handleDragMove(touch.clientY);
            }
          }
        })
      );
    };

    const handleTouchEnd = (event: TouchEvent): void => {
      const target = event.target as HTMLElement;
      Effect.runPromise(
        Effect.gen(function* () {
          const isDragging = yield* Ref.get(isDraggingRef);
          if (!isDragging) {
            handleEntryClick(target, entriesRef, projectsRef);
            return;
          }
          const touch = event.changedTouches[0];
          if (touch) {
            handleDragEnd(touch.clientY);
          }
        })
      );
    };

    // Add event listeners
    calendarEntriesContainer.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    calendarEntriesContainer.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
  });

