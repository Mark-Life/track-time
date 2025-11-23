import { Effect, Ref } from "effect";
import { chevronIcon } from "~/assets/icons";
import {
  type ComboboxOption,
  createCombobox,
  setComboboxValue,
  updateComboboxOptions,
} from "~/components/ui/combobox.ts";
import type { Entry, Project, WebSocketMessage } from "~/lib/types.ts";
import {
  createEntry,
  deleteEntry,
  getEntries,
  getProjects,
  updateEntry,
} from "../api.ts";
import { validateEntryForm } from "../infra/entry-handlers.ts";
import { updateDateDisplay } from "../ui/calendar-dom.ts";
import { showEntryDeleteLoading, showFormError } from "../ui/dom.ts";
import {
  calendarEntriesContainer,
  nextDayBtn,
  prevDayBtn,
  timelineContainer,
  todayBtn,
} from "../ui/dom-elements.ts";

const HOUR_HEIGHT = 60; // pixels per hour
const HOUR_REGEX = /(\d+)\s+(AM|PM)/;

/**
 * Gets the height per hour in pixels
 */
const getHourHeight = (): number => HOUR_HEIGHT;

/**
 * Filters entries for a specific day (based on start date)
 */
const filterEntriesForDay = (entries: Entry[], date: Date): Entry[] => {
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );

  return entries.filter((entry) => {
    const entryStart = new Date(entry.startedAt);
    return entryStart >= dayStart && entryStart <= dayEnd;
  });
};

/**
 * Splits an entry that crosses midnight into two entries
 */
const splitEntryAtMidnight = (entry: Entry): Entry[] => {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);
  const startDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );
  const endDay = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );

  // If entry doesn't cross midnight, return as-is
  if (endDay <= startDay) {
    return [entry];
  }

  // Calculate midnight timestamp
  const midnight = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate() + 1,
    0,
    0,
    0,
    0
  );

  // Calculate duration for first part (start to midnight)
  const firstDuration =
    (midnight.getTime() - startDate.getTime()) / (1000 * 60 * 60);

  // Calculate duration for second part (midnight to end)
  const secondDuration =
    (endDate.getTime() - midnight.getTime()) / (1000 * 60 * 60);

  // Create first entry (start to midnight)
  const firstEntry: Entry = {
    id: `${entry.id}-part1`,
    startedAt: entry.startedAt,
    endedAt: midnight.toISOString(),
    duration: firstDuration,
    projectId: entry.projectId,
  };

  // Create second entry (midnight to end)
  const secondEntry: Entry = {
    id: `${entry.id}-part2`,
    startedAt: midnight.toISOString(),
    endedAt: entry.endedAt,
    duration: secondDuration,
    projectId: entry.projectId,
  };

  return [firstEntry, secondEntry];
};

/**
 * Processes entries for a day: filters and splits entries that cross midnight
 */
const processEntriesForDay = (entries: Entry[], date: Date): Entry[] => {
  const dayEntries = filterEntriesForDay(entries, date);
  const processed: Entry[] = [];

  for (const entry of dayEntries) {
    const split = splitEntryAtMidnight(entry);
    processed.push(...split);
  }

  return processed;
};

/**
 * Finds the minimum hour from entries
 */
const findMinHour = (entries: Entry[]): number => {
  let minHour = 23;
  for (const entry of entries) {
    const startDate = new Date(entry.startedAt);
    const startHour = startDate.getHours();
    if (startHour < minHour) {
      minHour = startHour;
    }
  }
  return minHour;
};

/**
 * Finds the maximum hour from entries
 */
const findMaxHour = (entries: Entry[]): number => {
  let maxHour = 0;
  for (const entry of entries) {
    const endDate = new Date(entry.endedAt);
    const endHour = endDate.getHours();
    if (endHour > maxHour) {
      maxHour = endHour;
    }
  }
  return maxHour;
};

/**
 * Determines the time range to display based on entries
 * Returns { startHour, endHour } where startHour is 0-23 and endHour is 0-23
 */
const determineTimeRange = (
  entries: Entry[]
): { startHour: number; endHour: number } => {
  if (entries.length === 0) {
    // Default: 6 AM to 10 PM (22:00)
    return { startHour: 6, endHour: 22 };
  }

  const minHour = findMinHour(entries);
  const maxHour = findMaxHour(entries);

  // If there are entries before 6 AM, show from midnight (0)
  // Otherwise, start at 6 AM
  const startHour = minHour < 6 ? 0 : 6;

  // If there are entries after 10 PM (22:00), show until midnight (23)
  // Otherwise, end at 10 PM (22:00)
  const endHour = maxHour >= 22 ? 23 : 22;

  return { startHour, endHour };
};

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
 * Formats time for display (e.g., "9:30 AM")
 */
const formatTime = (date: Date): string => {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours %= 12;
  hours = hours ? hours : 12; // 0 should be 12

  const minutesStr = String(minutes).padStart(2, "0");
  return `${hours}:${minutesStr} ${ampm}`;
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

/**
 * Renders the calendar day view
 */
const renderCalendarDay = (
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
  });

/**
 * Renders a visual selection indicator overlay
 */
const renderSelectionIndicator = (
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
const clearSelectionIndicator = (container: HTMLElement): Effect.Effect<void> =>
  Effect.sync(() => {
    const indicatorContainer = container.querySelector(
      ".calendar-selection-indicator"
    ) as HTMLElement;
    if (indicatorContainer) {
      indicatorContainer.innerHTML = "";
    }
  });

/**
 * Parses hour from timeline marker text
 */
const parseHourFromMarker = (hourText: string): number | null => {
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
const getStartHourFromTimeline = (): number => {
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
const roundToNearest5Minutes = (date: Date): Date => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const roundedMinutes = Math.round(minutes / 5) * 5;
  rounded.setMinutes(roundedMinutes, 0, 0);
  return rounded;
};

/**
 * Gets the time from a Y position in the calendar container
 */
const getTimeFromPosition = (y: number, container: HTMLElement): Date => {
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
 * Renders entry edit form in the modal
 */
const renderEntryEditFormInModal = (
  entry: Entry,
  projects: Project[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const modal = document.getElementById("calendar-entry-modal");
    const modalContent = document.getElementById(
      "calendar-entry-modal-content"
    );
    if (!(modal && modalContent)) {
      return;
    }

    const isoToDatetimeLocal = (isoString: string): string => {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const comboboxId = `calendar-entry-${entry.id}-project-combobox`;
    const comboboxInputId = `calendar-entry-${entry.id}-project-combobox-input`;
    const comboboxListId = `calendar-entry-${entry.id}-project-combobox-list`;
    const hiddenInputId = `calendar-entry-${entry.id}-project-id-hidden`;

    const isNew = entry.id === "temp-new";

    modalContent.innerHTML = `
      <h3 class="text-lg font-bold mb-6">${isNew ? "Create Entry" : "Edit Entry"}</h3>
      <form class="calendar-edit-entry-form space-y-4" data-entry-id="${entry.id}">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Start Time</label>
          <input
            type="datetime-local"
            name="startedAt"
            value="${isoToDatetimeLocal(entry.startedAt)}"
            required
            class="px-3 py-2 border border-border rounded bg-background text-foreground"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">End Time</label>
          <input
            type="datetime-local"
            name="endedAt"
            value="${isoToDatetimeLocal(entry.endedAt)}"
            required
            class="px-3 py-2 border border-border rounded bg-background text-foreground"
          />
        </div>
        <div class="flex flex-col gap-2 mb-4 relative">
          <label class="text-sm font-medium">Project</label>
          <div
            id="${comboboxId}"
            class="combobox-container relative z-50"
            role="combobox"
            aria-expanded="false"
            aria-haspopup="listbox"
          >
            <div
              class="flex items-center border border-border rounded bg-background cursor-pointer"
            >
              <input
                id="${comboboxInputId}"
                type="text"
                placeholder="No project"
                autocomplete="off"
                class="flex-1 px-3 py-2 bg-transparent text-foreground outline-none"
                aria-autocomplete="list"
                aria-controls="${comboboxListId}"
                role="combobox"
              />
              <button
                data-combobox-button
                type="button"
                class="px-2 py-2 text-muted-foreground hover:text-foreground transition"
                aria-label="Toggle project list"
              >
                ${chevronIcon(16)}
              </button>
            </div>
            <div
            id="${comboboxListId}"
            class="relative w-full mt-1 border border-border rounded bg-popover shadow-lg max-h-96 overflow-auto hidden"
            role="listbox"
          ></div>
          </div>
          <input
            type="hidden"
            name="projectId"
            id="${hiddenInputId}"
          />
        </div>
        <div class="flex gap-2 justify-between">
          <div>
            ${
              isNew
                ? ""
                : `
            <button
              type="button"
              class="calendar-modal-delete-btn px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/80 cursor-pointer"
              data-entry-id="${entry.id}"
            >
              Delete
            </button>
            `
            }
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="calendar-cancel-edit-btn px-4 py-2 border border-border rounded hover:bg-muted cursor-pointer"
              data-entry-id="${entry.id}"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="calendar-save-edit-btn px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/80 cursor-pointer"
              data-entry-id="${entry.id}"
            >
              ${isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </form>
    `;

    modal.classList.remove("hidden");

    // Initialize combobox
    const projectOptions: ComboboxOption[] = [
      { value: "", label: "No project" },
      ...(projects || []).map((p) => ({ value: p.id, label: p.name })),
    ];

    yield* createCombobox({
      containerId: comboboxId,
      inputId: comboboxInputId,
      listId: comboboxListId,
      placeholder: "No project",
      emptyText: "No projects found",
      onSelect: (value) =>
        Effect.sync(() => {
          const hiddenInput = document.getElementById(
            hiddenInputId
          ) as HTMLInputElement;
          if (hiddenInput) {
            hiddenInput.value = value ?? "";
          }
        }),
    });

    yield* updateComboboxOptions(comboboxId, projectOptions);
    yield* setComboboxValue(comboboxId, entry.projectId || "");
  });

/**
 * Closes the calendar entry modal
 */
const closeCalendarModal = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const modal = document.getElementById("calendar-entry-modal");
    if (modal) {
      modal.classList.add("hidden");
    }
  });

/**
 * Refreshes calendar view after entry changes
 */
const refreshCalendarView = (refs: {
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      const entries: Entry[] = yield* getEntries;
      yield* Ref.set(refs.entriesRef, entries);
      const projects: Project[] = yield* Ref.get(refs.projectsRef);
      const currentDate = getCurrentDisplayedDate();
      yield* renderCalendarDay(entries, projects, currentDate);
    }),
    (error) => Effect.logError(`Failed to refresh calendar: ${error}`)
  );

/**
 * Handles create entry from modal
 */
const handleModalCreate = (params: {
  startedAt: string;
  endedAt: string;
  projectId: string | undefined;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
  form: HTMLFormElement;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* createEntry(params.startedAt, params.endedAt, params.projectId);
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to create entry: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to create entry";
        yield* showFormError(params.form, errorMessage);
      })
  );

/**
 * Handles update entry from modal
 */
const handleModalUpdate = (params: {
  entryId: string;
  startedAt: string;
  endedAt: string;
  projectId: string | undefined;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
  form: HTMLFormElement;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* updateEntry(
        params.entryId,
        params.startedAt,
        params.endedAt,
        params.projectId
      );
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to update entry: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to update entry";
        yield* showFormError(params.form, errorMessage);
      })
  );

/**
 * Handles delete entry from modal
 */
const handleModalDelete = (params: {
  entryId: string;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* showEntryDeleteLoading(params.entryId);
      yield* deleteEntry(params.entryId);
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to delete entry: ${error}`);
        yield* closeCalendarModal();
        yield* refreshCalendarView({
          entriesRef: params.entriesRef,
          projectsRef: params.projectsRef,
        });
      })
  );

/**
 * Sets up modal handlers (form submission, cancel, click outside)
 */
const setupModalHandlers = (
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): Effect.Effect<void> =>
  Effect.sync(() => {
    // Handle form validation and submission
    const processFormSubmission = (form: HTMLFormElement): void => {
      const entryId = form.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      const validation = validateEntryForm(form);
      if (!validation.valid) {
        Effect.runPromise(showFormError(form, validation.error));
        return;
      }

      const isNew = entryId === "temp-new";
      const params = {
        startedAt: validation.startedAt,
        endedAt: validation.endedAt,
        projectId: validation.projectId,
        entriesRef,
        projectsRef,
        form,
      };

      if (isNew) {
        Effect.runPromise(handleModalCreate(params));
        return;
      }

      Effect.runPromise(handleModalUpdate({ ...params, entryId }));
    };

    // Handle modal form submission (using event delegation)
    const handleFormSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      if (!form.classList.contains("calendar-edit-entry-form")) {
        return;
      }

      event.preventDefault();
      processFormSubmission(form);
    };

    // Handle cancel button
    const handleCancelClick = (): void => {
      Effect.runPromise(closeCalendarModal());
    };

    // Handle delete button
    const handleDeleteClick = (entryId: string): void => {
      Effect.runPromise(
        handleModalDelete({ entryId, entriesRef, projectsRef })
      );
    };

    // Process modal click actions
    const processModalClick = (target: HTMLElement): void => {
      const cancelBtn = target.closest(".calendar-cancel-edit-btn");
      if (cancelBtn) {
        handleCancelClick();
        return;
      }

      const deleteBtn = target.closest(".calendar-modal-delete-btn");
      if (deleteBtn) {
        const entryId = deleteBtn.getAttribute("data-entry-id");
        if (entryId) {
          handleDeleteClick(entryId);
        }
        return;
      }

      // Close modal when clicking outside
      if (target.id === "calendar-entry-modal") {
        handleCancelClick();
      }
    };

    // Handle cancel button, delete button, and click outside
    const handleModalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const modal = document.getElementById("calendar-entry-modal");
      if (!modal || modal.classList.contains("hidden")) {
        return;
      }

      processModalClick(target);
    };

    // Set up event listeners (only once)
    document.addEventListener("submit", handleFormSubmit);
    document.addEventListener("click", handleModalClick);
  });

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
const setupCalendarClickHandlers = (
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

/**
 * Gets the currently displayed date from the date display element
 */
const getCurrentDisplayedDate = (): Date => {
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
const setCurrentDisplayedDate = (date: Date): void => {
  const dateDisplay = document.getElementById("calendar-date-display");
  if (dateDisplay) {
    dateDisplay.setAttribute("data-date", date.toISOString());
  }
};

/**
 * Initializes day navigation handlers
 */
const initializeDayNavigation = (
  currentDate: Date,
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): Effect.Effect<void> =>
  Effect.sync(() => {
    setCurrentDisplayedDate(currentDate);

    prevDayBtn.addEventListener("click", () => {
      const current = getCurrentDisplayedDate();
      const prevDay = new Date(current);
      prevDay.setDate(prevDay.getDate() - 1);
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
      nextDay.setDate(nextDay.getDate() + 1);
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
            const projects = yield* Ref.get(projectsRef);
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
});
