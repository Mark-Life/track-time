import { Effect, Ref } from "effect";
import type { Entry, Project, WebSocketMessage } from "~/lib/types";
import { getEntries, getProjects } from "../api";
import { setupCalendarClickHandlers } from "./calendar/calendar-interactions";
import { setupModalHandlers } from "./calendar/calendar-modal";
import { initializeDayNavigation } from "./calendar/calendar-navigation";
import {
  renderCalendarDay,
  updateCurrentTimeIndicatorPosition,
} from "./calendar/calendar-rendering";
import {
  getCurrentDisplayedDate,
  parseHourFromMarker,
  setCurrentDisplayedDate,
} from "./calendar/calendar-utils";

/**
 * Main initialization function for the calendar page
 */
export const initializeCalendarPage = Effect.gen(function* () {
  // Create refs for entries and projects
  const entriesRef = yield* Ref.make<Entry[]>([]);
  const projectsRef = yield* Ref.make<Project[]>([]);

  // Load initial data
  const loadData = Effect.gen(function* () {
    const entries = yield* getEntries;
    const projects = yield* getProjects;

    yield* Ref.set(entriesRef, entries);
    yield* Ref.set(projectsRef, projects);

    // Render initial day (today)
    const today = new Date();
    setCurrentDisplayedDate(today);
    yield* renderCalendarDay(entries, projects, today);
  });

  yield* loadData;

  // Setup day navigation
  const today = new Date();
  yield* initializeDayNavigation(today, entriesRef, projectsRef);

  // Setup click handlers
  yield* setupCalendarClickHandlers(entriesRef, projectsRef);

  // Setup modal handlers
  yield* setupModalHandlers(entriesRef, projectsRef);

  // Setup WebSocket for real-time updates
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected (calendar page)"));
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

    // Handle entry-related messages
    if (
      message.type === "entry:updated" ||
      message.type === "entry:deleted" ||
      message.type === "timer:stopped"
    ) {
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* getEntries;
            yield* Ref.set(entriesRef, entries);
            const projects: Project[] = yield* Ref.get(projectsRef);
            const currentDate = getCurrentDisplayedDate();
            yield* renderCalendarDay(entries, projects, currentDate);
          }),
          (error) => Effect.logError(`Failed to update calendar: ${error}`)
        )
      );
    }
  };

  ws.onerror = (error) => {
    Effect.runPromise(Effect.logError(`WebSocket error: ${error}`));
  };

  ws.onclose = () => {
    Effect.runPromise(Effect.log("WebSocket disconnected (calendar page)"));
  };

  // Setup current time indicator updater (non-blocking, lightweight)
  /**
   * Gets time range from rendered timeline (lightweight, reads from DOM)
   */
  const getTimeRangeFromTimeline = (): {
    startHour: number;
    endHour: number;
  } | null => {
    const timeline = document.getElementById("calendar-timeline");
    if (!timeline) {
      return null;
    }

    const firstHourMarker = timeline.querySelector("div");
    if (!firstHourMarker) {
      return null;
    }

    const hourText = firstHourMarker.textContent?.trim();
    if (!hourText) {
      return null;
    }

    const startHour = parseHourFromMarker(hourText);
    if (startHour === null) {
      return null;
    }

    // Count hour markers to get end hour
    const hourMarkers = timeline.querySelectorAll("div");
    const endHour = startHour + hourMarkers.length - 1;

    return { startHour, endHour };
  };

  /**
   * Updates the current time indicator position (lightweight, synchronous, non-blocking)
   */
  const updateCurrentTimeIndicator = () => {
    // Read time range from already-rendered DOM (very fast, no entry processing)
    const timeRange = getTimeRangeFromTimeline();
    if (timeRange) {
      // Lightweight update - just change position, no DOM recreation
      updateCurrentTimeIndicatorPosition(
        timeRange.startHour,
        timeRange.endHour
      );
    }

    // Schedule next update in 1 second (non-blocking)
    setTimeout(updateCurrentTimeIndicator, 1000);
  };

  // Start the updater
  updateCurrentTimeIndicator();
});
