import { Effect } from "effect";

/**
 * Gets the calendar page container element
 */
export const getCalendarPageElement = (): HTMLElement => {
  const element = document.getElementById("calendar-page");
  if (!element) {
    throw new Error("Calendar page element not found");
  }
  return element;
};

/**
 * Gets the calendar entries container element
 */
export const getCalendarEntriesContainer = (): HTMLElement => {
  const element = document.getElementById("calendar-entries-container");
  if (!element) {
    throw new Error("Calendar entries container element not found");
  }
  return element;
};

/**
 * Gets the timeline container element
 */
export const getTimelineContainer = (): HTMLElement => {
  const element = document.getElementById("calendar-timeline");
  if (!element) {
    throw new Error("Timeline container element not found");
  }
  return element;
};

/**
 * Gets the date display element
 */
export const getDateDisplayElement = (): HTMLElement => {
  const element = document.getElementById("calendar-date-display");
  if (!element) {
    throw new Error("Date display element not found");
  }
  return element;
};

/**
 * Formats a date for display (e.g., "Monday, January 15, 2024")
 */
export const formatDateForDisplay = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
};

/**
 * Updates the date display element with the formatted date
 */
export const updateDateDisplay = (date: Date): Effect.Effect<void> =>
  Effect.sync(() => {
    const dateDisplay = getDateDisplayElement();
    dateDisplay.textContent = formatDateForDisplay(date);
  });

