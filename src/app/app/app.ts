import "~/global.css";
import type { Entry, Timer, WebSocketMessage } from "~/lib/types.ts";

// Accept HMR updates
if (import.meta.hot) {
  import.meta.hot.accept();
}

// DOM elements
const timerDisplay = document.getElementById("timer-display") as HTMLDivElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const entriesList = document.getElementById("entries-list") as HTMLDivElement;

// State
let activeTimer: Timer | null = null;
let timerInterval: number | null = null;

// WebSocket connection
const ws = new WebSocket(`ws://${window.location.host}/ws`);

ws.onopen = () => {
  console.log("WebSocket connected");
  loadInitialData();
};

ws.onmessage = (event) => {
  const message: WebSocketMessage = JSON.parse(event.data);

  if (message.type === "timer:started") {
    activeTimer = { startedAt: message.data.startedAt };
    startTimerUI();
  } else if (message.type === "timer:stopped") {
    stopTimerUI();
    addEntryToList(message.data.entry);
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("WebSocket disconnected");
};

// Load initial data
async function loadInitialData() {
  // Check for active timer
  const timerResponse = await fetch("/api/timer");
  const timer = await timerResponse.json();

  if (timer) {
    activeTimer = timer;
    startTimerUI();
  }

  // Load entries
  const entriesResponse = await fetch("/api/entries");
  const entries: Entry[] = await entriesResponse.json();
  renderEntries(entries);
}

// Start timer
startBtn.addEventListener("click", async () => {
  const response = await fetch("/api/timer/start", { method: "POST" });
  const timer: Timer = await response.json();
  activeTimer = timer;
  startTimerUI();
});

// Stop timer
stopBtn.addEventListener("click", async () => {
  const response = await fetch("/api/timer/stop", { method: "POST" });
  if (response.ok) {
    stopTimerUI();
    // dont need to add entry to list here because it is already added via websocket message
    // addEntryToList(entry);
  }
});

// UI: Start timer
function startTimerUI() {
  startBtn.disabled = true;
  stopBtn.disabled = false;

  // Start updating display
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    if (!activeTimer) {
      return;
    }

    const startTime = new Date(activeTimer.startedAt).getTime();
    const now = Date.now();
    const elapsed = now - startTime;

    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

    timerDisplay.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, 1000) as unknown as number;
}

// UI: Stop timer
function stopTimerUI() {
  activeTimer = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  timerDisplay.textContent = "Ready to start";

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Render entries list
function renderEntries(entries: Entry[]) {
  if (entries.length === 0) {
    entriesList.innerHTML =
      '<p class="text-gray-500" data-no-entries>No entries yet. Start tracking!</p>';
    return;
  }

  entriesList.innerHTML = entries.map((entry) => entryHTML(entry)).join("");
}

// Add single entry to list
function addEntryToList(entry: Entry) {
  // Add to top of list
  const entryElement = document.createElement("div");
  entryElement.innerHTML = entryHTML(entry);
  entriesList.insertBefore(
    entryElement.firstElementChild as HTMLElement,
    entriesList.firstChild
  );

  // Remove "no entries" message if exists
  const noEntries = entriesList.querySelector("[data-no-entries]");
  if (noEntries) {
    noEntries.remove();
  }
}

// Generate entry HTML
function entryHTML(entry: Entry): string {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);

  return `
    <div class="p-4 border border-gray-200 rounded">
      <div class="flex justify-between items-start">
        <div>
          <div class="text-sm text-gray-500">Started: ${startDate.toLocaleString()}</div>
          <div class="text-sm text-gray-500">Ended: ${endDate.toLocaleString()}</div>
        </div>
        <div class="text-xl font-bold">${entry.duration.toFixed(2)}h</div>
      </div>
    </div>
  `;
}
