import { Effect } from "effect";
import {
  chevronIcon,
  editIcon,
  loaderIcon,
  pauseIcon,
  playIcon,
  trashIcon,
} from "~/assets/icons";
import {
  type ComboboxOption,
  createCombobox,
  setComboboxValue,
  updateComboboxOptions,
} from "~/components/ui/combobox.ts";
import { showSkeleton } from "~/components/ui/skeleton.ts";
import type { Entry, Project } from "~/lib/types.ts";
import { entriesList, playPauseBtn, timerDisplay } from "./dom-elements.ts";

export const updateTimerDisplay = (text: string) =>
  Effect.sync(() => {
    timerDisplay.textContent = text;
  });

export const showPlayButton = () =>
  Effect.sync(() => {
    playPauseBtn.innerHTML = playIcon(24);
    playPauseBtn.setAttribute("aria-label", "Start timer");
    playPauseBtn.className =
      "bg-primary text-primary-foreground p-4 rounded-full hover:bg-primary/80 transition cursor-pointer flex items-center justify-center";
  });

export const showPauseButton = () =>
  Effect.sync(() => {
    playPauseBtn.innerHTML = pauseIcon(24);
    playPauseBtn.setAttribute("aria-label", "Pause timer");
    playPauseBtn.className =
      "bg-destructive text-destructive-foreground p-4 rounded-full hover:bg-destructive/80 transition cursor-pointer flex items-center justify-center";
    playPauseBtn.disabled = false;
  });

/**
 * Shows loading state on the timer button
 */
export const showTimerButtonLoading = () =>
  Effect.sync(() => {
    playPauseBtn.innerHTML = loaderIcon(24);
    playPauseBtn.setAttribute("aria-label", "Loading...");
    playPauseBtn.disabled = true;
    playPauseBtn.className =
      "bg-muted text-muted-foreground p-4 rounded-full transition cursor-not-allowed flex items-center justify-center opacity-60";
  });

const isoToDatetimeLocal = (isoString: string): string => {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

type DateBoundaries = {
  today: { year: number; month: number; day: number };
  yesterday: { year: number; month: number; day: number };
};

const getDateBoundaries = (): DateBoundaries => {
  const now = new Date();
  const today = {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  };

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = {
    year: yesterdayDate.getFullYear(),
    month: yesterdayDate.getMonth(),
    day: yesterdayDate.getDate(),
  };

  return { today, yesterday };
};

const formatEntryTime = (
  isoString: string,
  durationHours: number,
  boundaries?: DateBoundaries
): string => {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const b = boundaries ?? getDateBoundaries();

  // Check if today
  if (year === b.today.year && month === b.today.month && day === b.today.day) {
    return formatTime(date, durationHours, "Today");
  }

  // Check if yesterday
  if (
    year === b.yesterday.year &&
    month === b.yesterday.month &&
    day === b.yesterday.day
  ) {
    return formatTime(date, durationHours, "Yesterday");
  }

  // Format as "DD Mon, HH:MM:SS AM/PM" or "DD Mon, HH:MM AM/PM"
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthName = monthNames[month];
  const timeStr = formatTime(date, durationHours);
  return `${day} ${monthName}, ${timeStr}`;
};

const formatTime = (date: Date, durationHours: number, prefix = ""): string => {
  const showSeconds = durationHours <= 0.25; // 15 minutes = 0.25 hours

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";

  // Convert to 12-hour format
  hours %= 12;
  hours = hours ? hours : 12; // 0 should be 12

  const minutesStr = String(minutes).padStart(2, "0");
  const secondsStr = String(seconds).padStart(2, "0");

  const timeStr = showSeconds
    ? `${hours}:${minutesStr}:${secondsStr} ${ampm}`
    : `${hours}:${minutesStr} ${ampm}`;

  return prefix ? `${prefix}, ${timeStr}` : timeStr;
};

const entryHTML = (
  entry: Entry,
  projects: Project[] | undefined,
  isEditing = false,
  boundaries?: DateBoundaries
): string => {
  const projectName =
    entry.projectId && projects
      ? projects.find((p) => p.id === entry.projectId)?.name
      : undefined;

  if (isEditing) {
    const comboboxId = `entry-${entry.id}-project-combobox`;
    const comboboxInputId = `entry-${entry.id}-project-combobox-input`;
    const comboboxListId = `entry-${entry.id}-project-combobox-list`;

    return `
      <div class="p-4 border border-border rounded-lg" data-entry-id="${entry.id}">
        <form class="edit-entry-form space-y-3" data-entry-id="${entry.id}">
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
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Project</label>
            <div
              id="${comboboxId}"
              class="combobox-container relative"
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
                class="absolute z-50 w-full mt-1 border border-border rounded bg-popover shadow-lg max-h-60 overflow-auto hidden"
                role="listbox"
              ></div>
            </div>
            <input
              type="hidden"
              name="projectId"
              id="entry-${entry.id}-project-id-hidden"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              class="cancel-edit-btn px-4 py-2 border border-border rounded hover:bg-muted cursor-pointer"
              data-entry-id="${entry.id}"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="save-edit-btn px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/80 cursor-pointer"
              data-entry-id="${entry.id}"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    `;
  }

  return `
    <div class="group p-4 border border-border rounded-lg relative" data-entry-id="${entry.id}">
      <div class="flex justify-between items-center">
        <div>
          ${projectName ? `<div class="text-sm font-semibold text-primary mb-1">${projectName}</div>` : ""}
          <div class="text-sm text-gray-500">Started: ${formatEntryTime(entry.startedAt, entry.duration, boundaries)}</div>
          <div class="text-sm text-gray-500">Ended: ${formatEntryTime(entry.endedAt, entry.duration, boundaries)}</div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-md font-bold">${entry.duration.toFixed(2)}h</div>
          <div class="flex items-center gap-2">
            <button
              class="edit-entry-btn text-white bg-primary p-2 rounded-full hover:bg-primary/80 cursor-pointer flex items-center justify-center"
              data-entry-id="${entry.id}"
              aria-label="Edit entry"
            >
              ${editIcon(16)}
            </button>
            <button
              class="delete-entry-btn text-white bg-destructive p-2 rounded-full hover:bg-destructive/80 cursor-pointer flex items-center justify-center"
              data-entry-id="${entry.id}"
              aria-label="Delete entry"
            >
              ${trashIcon(16)}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
};

/**
 * Shows loading skeleton for entries
 */
export const showEntriesLoading = () =>
  showSkeleton("entries-list", { variant: "entry", count: 3 });

export const renderEntries = (
  entries: Entry[],
  projects: Project[] | undefined = []
) =>
  Effect.sync(() => {
    if (entries.length === 0) {
      entriesList.innerHTML =
        '<p class="text-gray-500" data-no-entries>No entries yet. Start tracking!</p>';
      return;
    }

    const boundaries = getDateBoundaries();
    entriesList.innerHTML = entries
      .map((entry) => entryHTML(entry, projects, false, boundaries))
      .join("");
  });

export const renderEntryEditForm = (
  entry: Entry,
  projects: Project[] | undefined = []
) =>
  Effect.gen(function* () {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entry.id}"]`
    ) as HTMLElement;
    if (entryElement) {
      entryElement.outerHTML = entryHTML(entry, projects, true);
    }

    // Initialize combobox for this entry
    const comboboxId = `entry-${entry.id}-project-combobox`;
    const hiddenInputId = `entry-${entry.id}-project-id-hidden`;

    const projectOptions: ComboboxOption[] = [
      { value: "", label: "No project" },
      ...(projects || []).map((p) => ({ value: p.id, label: p.name })),
    ];

    yield* createCombobox({
      containerId: comboboxId,
      inputId: `entry-${entry.id}-project-combobox-input`,
      listId: `entry-${entry.id}-project-combobox-list`,
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

export const renderEntryView = (
  entry: Entry,
  projects: Project[] | undefined = []
) =>
  Effect.sync(() => {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entry.id}"]`
    ) as HTMLElement;
    if (entryElement) {
      const boundaries = getDateBoundaries();
      entryElement.outerHTML = entryHTML(entry, projects, false, boundaries);
    }
  });

export const addEntryToList = (
  entry: Entry,
  projects: Project[] | undefined = []
) =>
  Effect.sync(() => {
    const boundaries = getDateBoundaries();
    const entryElement = document.createElement("div");
    entryElement.innerHTML = entryHTML(entry, projects, false, boundaries);
    entriesList.insertBefore(
      entryElement.firstElementChild as HTMLElement,
      entriesList.firstChild
    );

    const noEntries = entriesList.querySelector("[data-no-entries]");
    if (noEntries) {
      noEntries.remove();
    }
  });

export const showFormError = (form: HTMLFormElement, message: string) =>
  Effect.sync(() => {
    // Remove existing error if any
    const existingError = form.querySelector(".form-error");
    if (existingError) {
      existingError.remove();
    }

    // Create error element
    const errorElement = document.createElement("div");
    errorElement.className =
      "form-error text-red-500 text-sm mt-2 p-2 bg-red-50 border border-red-200 rounded";
    errorElement.textContent = message;
    form.appendChild(errorElement);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorElement.remove();
    }, 5000);
  });

/**
 * Shows loading state on a delete button for an entry
 */
export const showEntryDeleteLoading = (entryId: string) =>
  Effect.sync(() => {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entryId}"]`
    ) as HTMLElement;
    if (!entryElement) {
      return;
    }

    const deleteBtn = entryElement.querySelector(
      ".delete-entry-btn"
    ) as HTMLButtonElement;
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = loaderIcon(16);
      deleteBtn.className =
        "delete-entry-btn text-white bg-muted p-2 rounded-full cursor-not-allowed flex items-center justify-center opacity-60";
      deleteBtn.setAttribute("aria-label", "Deleting...");
    }

    // Add loading overlay to the entire entry
    entryElement.style.opacity = "0.6";
    entryElement.style.pointerEvents = "none";
  });

/**
 * Removes loading state from an entry
 */
export const removeEntryDeleteLoading = (entryId: string) =>
  Effect.sync(() => {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entryId}"]`
    ) as HTMLElement;
    if (!entryElement) {
      return;
    }

    const deleteBtn = entryElement.querySelector(
      ".delete-entry-btn"
    ) as HTMLButtonElement;
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = trashIcon(16);
      deleteBtn.className =
        "delete-entry-btn text-white bg-destructive p-2 rounded-full hover:bg-destructive/80 cursor-pointer flex items-center justify-center";
      deleteBtn.setAttribute("aria-label", "Delete entry");
    }

    // Remove loading overlay
    entryElement.style.opacity = "";
    entryElement.style.pointerEvents = "";
  });
