import { Effect, Ref } from "effect";
import type { Entry, Project } from "~/lib/types.ts";
import { nextDayBtn, prevDayBtn, todayBtn } from "../../ui/dom-elements.ts";
import { renderCalendarDay } from "./calendar-rendering.ts";
import {
  getCurrentDisplayedDate,
  setCurrentDisplayedDate,
} from "./calendar-utils.ts";

/**
 * Initializes day navigation handlers
 */
export const initializeDayNavigation = (
  currentDate: Date,
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): Effect.Effect<void> =>
  Effect.sync(() => {
    setCurrentDisplayedDate(currentDate);

    prevDayBtn.addEventListener("click", () => {
      const current = getCurrentDisplayedDate();
      const prevDay = new Date(current);
      prevDay.setDate(prevDay.getDate() - 1); // Switch by 1 day
      setCurrentDisplayedDate(prevDay);
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* Ref.get(entriesRef);
            const projects = yield* Ref.get(projectsRef);
            yield* renderCalendarDay(entries, projects, prevDay);
          }),
          (error) =>
            Effect.logError(`Failed to navigate to previous day: ${error}`)
        )
      );
    });

    nextDayBtn.addEventListener("click", () => {
      const current = getCurrentDisplayedDate();
      const nextDay = new Date(current);
      nextDay.setDate(nextDay.getDate() + 1); // Switch by 1 day
      setCurrentDisplayedDate(nextDay);
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* Ref.get(entriesRef);
            const projects = yield* Ref.get(projectsRef);
            yield* renderCalendarDay(entries, projects, nextDay);
          }),
          (error) => Effect.logError(`Failed to navigate to next day: ${error}`)
        )
      );
    });

    todayBtn.addEventListener("click", () => {
      const today = new Date();
      setCurrentDisplayedDate(today);
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* Ref.get(entriesRef);
            const projects = yield* Ref.get(projectsRef);
            yield* renderCalendarDay(entries, projects, today);
          }),
          (error) => Effect.logError(`Failed to navigate to today: ${error}`)
        )
      );
    });
  });

