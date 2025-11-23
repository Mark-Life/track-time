import { Effect } from "effect";
import type { Entry, Project } from "~/lib/types.ts";
import {
  calendarEntriesContainer,
  timelineContainer,
} from "../../ui/dom-elements.ts";
import { HOUR_HEIGHT } from "./calendar-constants.ts";
import {
  calculateCurrentTimePosition,
  formatTime,
  getHourHeight,
  isViewingToday,
} from "./calendar-utils.ts";

/**
 * Calculates the position (top and height) for an entry block
 */
const calculateEntryPosition = (
  entry: Entry,
  hourHeight: number,
  startHour: number
): { top: number; height: number } => {
  const startDate = new Date(entry.startedAt);
  const entryHour = startDate.getHours();
  const startMinutes = startDate.getMinutes();
  const startSeconds = startDate.getSeconds();

  // Calculate top position in pixels, accounting for startHour offset
  const top =
    (entryHour - startHour) * hourHeight +
    (startMinutes * hourHeight) / 60 +
    (startSeconds * hourHeight) / 3600;

  // Calculate height based on duration
  const height = Math.max(entry.duration * hourHeight, 20); // Minimum 20px height

  return { top, height };
};

/**
 * Generates HTML for an entry block
 */
const renderEntryBlock = (
  entry: Entry,
  projects: Project[] | undefined,
  position: { top: number; height: number }
): string => {
  const projectName =
    entry.projectId && projects
      ? projects.find((p) => p.id === entry.projectId)?.name
      : undefined;

  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);
  const timeRange = `${formatTime(startDate)} - ${formatTime(endDate)} (${entry.duration.toFixed(2)}h)`;

  const height = position.height;
  const SMALL_THRESHOLD = 40; // Below this, use single line
  const VERY_SMALL_THRESHOLD = 25; // Below this, show only project name

  let content: string;
  let containerClass: string;

  if (height < VERY_SMALL_THRESHOLD) {
    // Very small: only project name, smaller font, vertically centered
    content = `<div class="text-[10px] font-semibold text-primary truncate">${projectName || "No project"}</div>`;
    containerClass = "flex items-center px-1";
  } else if (height < SMALL_THRESHOLD) {
    // Small: project name and time in one line, vertically centered
    content = `<div class="text-xs font-semibold text-primary truncate">${projectName || "No project"} <span class="text-[10px] text-muted-foreground font-normal">${timeRange}</span></div>`;
    containerClass = "flex items-center px-1.5";
  } else {
    // Normal: two lines with full info
    content = `
      <div class="text-xs font-semibold text-primary mb-1">${projectName || "No project"}</div>
      <div class="text-xs text-muted-foreground">${timeRange}</div>
    `;
    containerClass = "p-2";
  }

  return `
    <div
      class="absolute left-0 right-0 ${containerClass} border border-border rounded bg-primary/20 hover:bg-primary/20 transition cursor-pointer overflow-hidden"
      style="top: ${position.top}px; height: ${position.height}px; min-height: ${position.height}px;"
      data-entry-id="${entry.id}"
    >
      ${content}
    </div>
  `;
};

/**
 * Renders the timeline with hour markers
 */
const renderTimeline = (
  container: HTMLElement,
  startHour: number,
  endHour: number
): Effect.Effect<void> =>
  Effect.sync(() => {
    const hours = Array.from(
      { length: endHour - startHour + 1 },
      (_, i) => startHour + i
    );
    const hourLabels = hours.map((hour) => {
      const hour12 = hour % 12 || 12;
      const ampm = hour < 12 ? "AM" : "PM";
      return { hour, label: `${hour12} ${ampm}` };
    });

    container.innerHTML = hourLabels
      .map((item, index) => {
        // Don't add border-b to the last hour to avoid double line with container border
        const borderClass =
          index === hourLabels.length - 1 ? "" : "border-b border-border";
        return `
      <div
        class="${borderClass} px-2 py-1 text-xs text-muted-foreground"
        style="height: ${HOUR_HEIGHT}px;"
      >
        ${item.label}
      </div>
    `;
      })
      .join("");
  });

/**
 * Renders horizontal hour lines in the calendar
 */
const renderHourLines = (
  container: HTMLElement,
  startHour: number,
  endHour: number
): Effect.Effect<void> =>
  Effect.sync(() => {
    const hourHeight = getHourHeight();
    const hours = Array.from(
      { length: endHour - startHour + 1 },
      (_, i) => startHour + i
    );

    // Create hour lines container if it doesn't exist
    let linesContainer = container.querySelector(
      ".calendar-hour-lines"
    ) as HTMLElement;
    if (!linesContainer) {
      linesContainer = document.createElement("div");
      linesContainer.className =
        "calendar-hour-lines absolute inset-0 pointer-events-none";
      container.appendChild(linesContainer);
    }

    // Render hour lines to align with timeline's border-b
    // Timeline divs have height: HOUR_HEIGHT and border-b at bottom
    // So borders appear at: HOUR_HEIGHT, 2*HOUR_HEIGHT, 3*HOUR_HEIGHT, etc.
    // Use border-t positioned 1px above to account for border thickness
    // Exclude the last hour since the container border handles the bottom edge
    const hourLines = hours
      .slice(0, -1) // Exclude last hour to avoid double line with container border
      .map((hour) => {
        // Position at the bottom of each hour cell, but 1px up to align with border-b
        const top = (hour - startHour + 1) * hourHeight - 1;
        return `
          <div
            class="border-t border-primary/20"
            style="position: absolute; top: ${top}px; left: 0; right: 0; height: 0;"
          ></div>
        `;
      })
      .join("");

    // Add top border line at position 0
    const topLine = `
      <div
        class="border-t border-primary/20"
        style="position: absolute; top: 0px; left: 0; right: 0; height: 0;"
      ></div>
    `;

    linesContainer.innerHTML = topLine + hourLines;
  });

/**
 * Renders entry blocks for a day
 */
const renderEntryBlocks = (
  entries: Entry[],
  projects: Project[] | undefined,
  container: HTMLElement,
  startHour: number
): Effect.Effect<void> =>
  Effect.sync(() => {
    // Clear only entry blocks, not hour lines
    const entryBlocks = container.querySelectorAll("[data-entry-id]");
    for (const block of Array.from(entryBlocks)) {
      block.remove();
    }

    const hourHeight = getHourHeight();

    // Create entries container if it doesn't exist
    let entriesContainer = container.querySelector(
      ".calendar-entries-blocks"
    ) as HTMLElement;
    if (!entriesContainer) {
      entriesContainer = document.createElement("div");
      entriesContainer.className = "calendar-entries-blocks absolute inset-0";
      container.appendChild(entriesContainer);
    }

    entriesContainer.innerHTML = "";

    for (const entry of entries) {
      const position = calculateEntryPosition(entry, hourHeight, startHour);
      const blockHTML = renderEntryBlock(entry, projects, position);
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = blockHTML;
      const blockElement = tempDiv.firstElementChild as HTMLElement;
      if (blockElement) {
        entriesContainer.appendChild(blockElement);
      }
    }
  });

import { updateDateDisplay } from "../../ui/calendar-dom.ts";
import { processEntriesForDay } from "./calendar-entry-processing.ts";
import { determineTimeRange } from "./calendar-time-range.ts";

/**
 * Updates the current time indicator position (lightweight, non-blocking)
 * Only updates position if indicator exists and we're viewing today
 */
export const updateCurrentTimeIndicatorPosition = (
  startHour: number,
  endHour: number
): void => {
  const parentContainer = calendarEntriesContainer.parentElement;
  if (!parentContainer) {
    return;
  }

  const indicator = parentContainer.querySelector(
    ".current-time-indicator"
  ) as HTMLElement | null;

  // Only show if viewing today
  if (!isViewingToday()) {
    if (indicator) {
      indicator.remove();
    }
    return;
  }

  const position = calculateCurrentTimePosition(startHour, endHour);
  if (position === null) {
    if (indicator) {
      indicator.remove();
    }
    return;
  }

  // Update existing indicator position (fast path)
  if (indicator) {
    indicator.style.top = `${position}px`;
    return;
  }

  // Create indicator only if it doesn't exist (slow path, only on first render)
  const newIndicator = document.createElement("div");
  newIndicator.className =
    "current-time-indicator absolute left-0 right-0 pointer-events-none z-10";
  newIndicator.style.top = `${position}px`;
  newIndicator.style.transform = "translateY(-50%)";

  // Red line spanning the full width
  const line = document.createElement("div");
  line.className = "h-0.5 bg-destructive";
  newIndicator.appendChild(line);

  // Red dot on the left (timeline side)
  const dot = document.createElement("div");
  dot.className =
    "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-destructive";
  dot.style.width = "8px";
  dot.style.height = "8px";
  newIndicator.appendChild(dot);

  parentContainer.appendChild(newIndicator);
};

/**
 * Renders or updates the current time indicator (red line)
 */
export const renderCurrentTimeIndicator = (
  startHour: number,
  endHour: number
): Effect.Effect<void> =>
  Effect.sync(() => {
    updateCurrentTimeIndicatorPosition(startHour, endHour);
  });

/**
 * Renders the calendar day view
 */
export const renderCalendarDay = (
  entries: Entry[],
  projects: Project[] | undefined,
  date: Date
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* updateDateDisplay(date);

    const processedEntries = processEntriesForDay(entries, date);
    const { startHour, endHour } = determineTimeRange(processedEntries);

    // Update container height based on time range
    const hourHeight = getHourHeight();
    const totalHours = endHour - startHour + 1;
    const containerHeight = totalHours * hourHeight;
    calendarEntriesContainer.style.minHeight = `${containerHeight}px`;

    yield* renderTimeline(timelineContainer, startHour, endHour);
    yield* renderHourLines(calendarEntriesContainer, startHour, endHour);
    yield* renderEntryBlocks(
      processedEntries,
      projects,
      calendarEntriesContainer,
      startHour
    );
    yield* renderCurrentTimeIndicator(startHour, endHour);
  });
