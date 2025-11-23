import { HOUR_HEIGHT, HOUR_REGEX } from "./calendar-constants.ts";

/**
 * Gets the height per hour in pixels
 */
export const getHourHeight = (): number => HOUR_HEIGHT;

/**
 * Formats time for display (e.g., "9:30 AM")
 */
export const formatTime = (date: Date): string => {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours %= 12;
  hours = hours ? hours : 12; // 0 should be 12

  const minutesStr = String(minutes).padStart(2, "0");
  return `${hours}:${minutesStr} ${ampm}`;
};

/**
 * Parses hour from timeline marker text
 */
export const parseHourFromMarker = (hourText: string): number | null => {
  const hourMatch = hourText.match(HOUR_REGEX);
  if (!hourMatch || hourMatch.length < 3 || !hourMatch[1] || !hourMatch[2]) {
    return null;
  }

  let hour = Number.parseInt(hourMatch[1], 10);
  const ampm = hourMatch[2];
  if (ampm === "PM" && hour !== 12) {
    hour += 12;
  } else if (ampm === "AM" && hour === 12) {
    hour = 0;
  }
  return hour;
};

/**
 * Gets the start hour from the timeline
 */
export const getStartHourFromTimeline = (): number => {
  const timeline = document.getElementById("calendar-timeline");
  if (!timeline) {
    return 0;
  }

  const firstHourMarker = timeline.querySelector("div");
  if (!firstHourMarker) {
    return 0;
  }

  const hourText = firstHourMarker.textContent?.trim();
  if (!hourText) {
    return 0;
  }

  return parseHourFromMarker(hourText) ?? 0;
};

/**
 * Rounds a date to the nearest 5-minute interval
 */
export const roundToNearest5Minutes = (date: Date): Date => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const roundedMinutes = Math.round(minutes / 5) * 5;
  rounded.setMinutes(roundedMinutes, 0, 0);
  return rounded;
};

/**
 * Gets the time from a Y position in the calendar container
 */
export const getTimeFromPosition = (
  y: number,
  container: HTMLElement
): Date => {
  const rect = container.getBoundingClientRect();
  const relativeY = y - rect.top;
  const hourHeight = getHourHeight();

  // Get the current displayed date from the date display
  const dateDisplay = document.getElementById("calendar-date-display");
  if (!dateDisplay) {
    return new Date();
  }

  // Parse the date from the display (we'll store it in a data attribute)
  const displayedDateStr = dateDisplay.getAttribute("data-date");
  const displayedDate = displayedDateStr
    ? new Date(displayedDateStr)
    : new Date();

  // Get the start hour from the timeline
  const startHour = getStartHourFromTimeline();

  // Calculate clicked hour relative to start hour
  const relativeHour = Math.floor(relativeY / hourHeight);
  const clickedHour = startHour + relativeHour;
  const clickedMinutes = Math.floor(
    ((relativeY % hourHeight) / hourHeight) * 60
  );

  const clickedTime = new Date(displayedDate);
  clickedTime.setHours(clickedHour, clickedMinutes, 0, 0);

  return clickedTime;
};

/**
 * Gets the currently displayed date from the date display element
 */
export const getCurrentDisplayedDate = (): Date => {
  const dateDisplay = document.getElementById("calendar-date-display");
  if (!dateDisplay) {
    return new Date();
  }

  const dateStr = dateDisplay.getAttribute("data-date");
  if (dateStr) {
    return new Date(dateStr);
  }

  return new Date();
};

/**
 * Sets the displayed date in the date display element
 */
export const setCurrentDisplayedDate = (date: Date): void => {
  const dateDisplay = document.getElementById("calendar-date-display");
  if (dateDisplay) {
    dateDisplay.setAttribute("data-date", date.toISOString());
  }
};

/**
 * Checks if the currently displayed date is today
 */
export const isViewingToday = (): boolean => {
  const displayedDate = getCurrentDisplayedDate();
  const today = new Date();

  return (
    displayedDate.getFullYear() === today.getFullYear() &&
    displayedDate.getMonth() === today.getMonth() &&
    displayedDate.getDate() === today.getDate()
  );
};

/**
 * Calculates the pixel position for the current time
 * Returns null if current time is outside the visible range
 */
export const calculateCurrentTimePosition = (
  startHour: number,
  endHour: number
): number | null => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentSeconds = now.getSeconds();

  // Check if current time is within visible range
  if (currentHour < startHour || currentHour > endHour) {
    return null;
  }

  const hourHeight = getHourHeight();
  const top =
    (currentHour - startHour) * hourHeight +
    (currentMinutes * hourHeight) / 60 +
    (currentSeconds * hourHeight) / 3600;

  return top;
};
