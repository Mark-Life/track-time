import { Effect } from "effect";
import type { Entry } from "~/lib/types.ts";
import {
  entriesList,
  startBtn,
  stopBtn,
  timerDisplay,
} from "./dom-elements.ts";

export const updateTimerDisplay = (text: string) =>
  Effect.sync(() => {
    timerDisplay.textContent = text;
  });

export const setStartBtnDisabled = (disabled: boolean) =>
  Effect.sync(() => {
    startBtn.disabled = disabled;
  });

export const setStopBtnDisabled = (disabled: boolean) =>
  Effect.sync(() => {
    stopBtn.disabled = disabled;
  });

const entryHTML = (entry: Entry): string => {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);

  return `
    <div class="group p-4 border border-gray-200 rounded relative" data-entry-id="${entry.id}">
      <div class="flex justify-between items-start">
        <div>
          <div class="text-sm text-gray-500">Started: ${startDate.toLocaleString()}</div>
          <div class="text-sm text-gray-500">Ended: ${endDate.toLocaleString()}</div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-xl font-bold">${entry.duration.toFixed(2)}h</div>
          <button
            class="delete-entry-btn opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 text-white px-2 py-1 rounded text-sm hover:bg-red-700"
            data-entry-id="${entry.id}"
            aria-label="Delete entry"
          >
            Delete
          </button>
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
