import { Effect } from "effect";

let offlineIndicator: HTMLDivElement | null = null;

export const showOfflineIndicator = Effect.sync(() => {
  if (offlineIndicator) {
    return;
  }

  offlineIndicator = document.createElement("div");
  offlineIndicator.className =
    "fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded shadow-lg text-sm";
  offlineIndicator.textContent = "Offline";
  document.body.appendChild(offlineIndicator);
});

export const hideOfflineIndicator = Effect.sync(() => {
  if (offlineIndicator) {
    offlineIndicator.remove();
    offlineIndicator = null;
  }
});
