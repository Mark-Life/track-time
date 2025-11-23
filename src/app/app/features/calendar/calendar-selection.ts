import { Effect } from "effect";
import { getHourHeight, getStartHourFromTimeline } from "./calendar-utils.ts";

/**
 * Renders a visual selection indicator overlay
 */
export const renderSelectionIndicator = (
  startTime: Date,
  endTime: Date,
  container: HTMLElement
): Effect.Effect<void> =>
  Effect.sync(() => {
    // Ensure startTime <= endTime (swap if needed)
    const actualStart = startTime <= endTime ? startTime : endTime;
    const actualEnd = startTime <= endTime ? endTime : startTime;

    const startHour = getStartHourFromTimeline();
    const hourHeight = getHourHeight();

    // Calculate positions
    const startDate = new Date(actualStart);
    const endDate = new Date(actualEnd);
    const startHourValue = startDate.getHours();
    const startMinutes = startDate.getMinutes();
    const endHourValue = endDate.getHours();
    const endMinutes = endDate.getMinutes();

    const top =
      (startHourValue - startHour) * hourHeight +
      (startMinutes * hourHeight) / 60;
    const endTop =
      (endHourValue - startHour) * hourHeight + (endMinutes * hourHeight) / 60;
    const height = Math.max(endTop - top, 20); // Minimum 20px height

    // Create or get selection indicator container
    let indicatorContainer = container.querySelector(
      ".calendar-selection-indicator"
    ) as HTMLElement;
    if (!indicatorContainer) {
      indicatorContainer = document.createElement("div");
      indicatorContainer.className =
        "calendar-selection-indicator absolute inset-0 pointer-events-none z-10";
      container.appendChild(indicatorContainer);
    }

    // Render selection indicator
    indicatorContainer.innerHTML = `
      <div
        class="absolute left-0 right-0 border-2 border-primary bg-primary/10 rounded"
        style="top: ${top}px; height: ${height}px; min-height: ${height}px;"
      ></div>
    `;
  });

/**
 * Clears the selection indicator overlay
 */
export const clearSelectionIndicator = (
  container: HTMLElement
): Effect.Effect<void> =>
  Effect.sync(() => {
    const indicatorContainer = container.querySelector(
      ".calendar-selection-indicator"
    ) as HTMLElement;
    if (indicatorContainer) {
      indicatorContainer.innerHTML = "";
    }
  });
