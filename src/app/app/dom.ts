import { Effect } from "effect";
import { editIcon, pauseIcon, playIcon, trashIcon } from "~/assets/icons";
import type { Entry } from "~/lib/types.ts";
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

const entryHTML = (entry: Entry, isEditing = false): string => {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);

  if (isEditing) {
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
          <div class="text-sm text-gray-500">Started: ${startDate.toLocaleString()}</div>
          <div class="text-sm text-gray-500">Ended: ${endDate.toLocaleString()}</div>
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

export const renderEntries = (entries: Entry[]) =>
  Effect.sync(() => {
    if (entries.length === 0) {
      entriesList.innerHTML =
        '<p class="text-gray-500" data-no-entries>No entries yet. Start tracking!</p>';
      return;
    }

    entriesList.innerHTML = entries.map((entry) => entryHTML(entry)).join("");
  });

export const renderEntryEditForm = (entry: Entry) =>
  Effect.sync(() => {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entry.id}"]`
    ) as HTMLElement;
    if (entryElement) {
      entryElement.outerHTML = entryHTML(entry, true);
    }
  });

export const renderEntryView = (entry: Entry) =>
  Effect.sync(() => {
    const entryElement = entriesList.querySelector(
      `[data-entry-id="${entry.id}"]`
    ) as HTMLElement;
    if (entryElement) {
      entryElement.outerHTML = entryHTML(entry, false);
    }
  });

export const addEntryToList = (entry: Entry) =>
  Effect.sync(() => {
    const entryElement = document.createElement("div");
    entryElement.innerHTML = entryHTML(entry);
    entriesList.insertBefore(
      entryElement.firstElementChild as HTMLElement,
      entriesList.firstChild
    );

    const noEntries = entriesList.querySelector("[data-no-entries]");
    if (noEntries) {
      noEntries.remove();
    }
  });
