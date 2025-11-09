import { Effect } from "effect";
import { pauseIcon, playIcon, trashIcon } from "~/assets/icons";
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
      "bg-green-600 text-white p-4 rounded-full hover:bg-green-700 transition cursor-pointer flex items-center justify-center";
  });

export const showPauseButton = () =>
  Effect.sync(() => {
    playPauseBtn.innerHTML = pauseIcon(24);
    playPauseBtn.setAttribute("aria-label", "Pause timer");
    playPauseBtn.className =
      "bg-yellow-600 text-white p-4 rounded-full hover:bg-yellow-700 transition cursor-pointer flex items-center justify-center";
  });

const entryHTML = (entry: Entry): string => {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);

  return `
    <div class="group p-4 border border-(--border) rounded-lg relative" data-entry-id="${entry.id}">
      <div class="flex justify-between items-center">
        <div>
          <div class="text-sm text-gray-500">Started: ${startDate.toLocaleString()}</div>
          <div class="text-sm text-gray-500">Ended: ${endDate.toLocaleString()}</div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-xl font-bold">${entry.duration.toFixed(2)}h</div>
          <button
            class="delete-entry-btn opacity-0 group-hover:opacity-100 transition-opacity text-white bg-(--destructive) p-2 rounded-full hover:bg-(--destructive)/80 cursor-pointer flex items-center justify-center"
            data-entry-id="${entry.id}"
            aria-label="Delete entry"
          >
            ${trashIcon(16)}
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
