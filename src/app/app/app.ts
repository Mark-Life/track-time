import "~/global.css";
import { Effect, Ref } from "effect";
import {
  clearLocalTimer,
  getLocalEntries,
  getTimerFromLocal,
  saveEntryToLocal,
  saveTimerToLocal,
} from "~/lib/local-storage.ts";
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

// Offline status indicator
let offlineIndicator: HTMLDivElement | null = null;

// API functions with offline support
const getTimer = Effect.gen(function* () {
  if (!navigator.onLine) {
    const localTimer = yield* getTimerFromLocal();
    return localTimer;
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer"),
    catch: (error) => new Error(`Failed to fetch timer: ${error}`),
  });

  if (!response.ok) {
    const localTimer = yield* getTimerFromLocal();
    return localTimer;
  }

  const timer = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Timer | null>,
    catch: (error) => new Error(`Failed to parse timer JSON: ${error}`),
  });

  return timer;
});

const startTimer = Effect.gen(function* () {
  const timer: Timer = { startedAt: new Date().toISOString() };

  if (!navigator.onLine) {
    yield* saveTimerToLocal(timer);
    return timer;
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer/start", { method: "POST" }),
    catch: (error) => {
      Effect.runSync(saveTimerToLocal(timer));
      return new Error(`Failed to start timer: ${error}`);
    },
  });

  if (!response.ok) {
    yield* saveTimerToLocal(timer);
    return timer;
  }

  const serverTimer = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Timer>,
    catch: (error) => {
      Effect.runSync(saveTimerToLocal(timer));
      return new Error(`Failed to parse timer JSON: ${error}`);
    },
  });

  return serverTimer;
});

const stopTimer = Effect.gen(function* () {
  // Get timer from local storage or server
  // Prioritize local timer if it exists (preserves original start time)
  const localTimer = yield* getTimerFromLocal();
  let timer: Timer | null = localTimer;

  if (!timer && navigator.onLine) {
    const serverTimer = yield* getTimer;
    timer = serverTimer;
  }

  if (!timer) {
    yield* Effect.fail(new Error("No active timer"));
    return;
  }

  const endedAt = new Date().toISOString();
  const startTime = new Date(timer.startedAt).getTime();
  const endTime = new Date(endedAt).getTime();
  const duration = (endTime - startTime) / (1000 * 60 * 60);

  const entry: Entry = {
    id: crypto.randomUUID(),
    startedAt: timer.startedAt,
    endedAt,
    duration,
  };

  if (!navigator.onLine) {
    yield* saveEntryToLocal(entry);
    yield* clearLocalTimer();
    return entry;
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer/stop", { method: "POST" }),
    catch: (error) => {
      Effect.runSync(saveEntryToLocal(entry));
      Effect.runSync(clearLocalTimer());
      return new Error(`Failed to stop timer: ${error}`);
    },
  });

  if (!response.ok) {
    yield* saveEntryToLocal(entry);
    yield* clearLocalTimer();
    return entry;
  }

  const serverEntry = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Entry>,
    catch: (error) => {
      Effect.runSync(saveEntryToLocal(entry));
      Effect.runSync(clearLocalTimer());
      return new Error(`Failed to parse entry JSON: ${error}`);
    },
  });

  yield* clearLocalTimer();
  return serverEntry;
});

const getEntries = Effect.gen(function* () {
  const localEntries = yield* getLocalEntries();

  if (!navigator.onLine) {
    return localEntries;
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/entries"),
    catch: (error) => new Error(`Failed to fetch entries: ${error}`),
  });

  if (!response.ok) {
    return localEntries;
  }

  const serverEntries = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Entry[]>,
    catch: (error) => new Error(`Failed to parse entries JSON: ${error}`),
  });

  // Merge local and server entries, removing duplicates by ID
  const serverIds = new Set(serverEntries.map((e) => e.id));
  const uniqueLocalEntries = localEntries.filter((e) => !serverIds.has(e.id));
  return [...serverEntries, ...uniqueLocalEntries].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
});

// DOM operations
const updateTimerDisplay = (text: string) =>
  Effect.sync(() => {
    timerDisplay.textContent = text;
  });

const setStartBtnDisabled = (disabled: boolean) =>
  Effect.sync(() => {
    startBtn.disabled = disabled;
  });

const setStopBtnDisabled = (disabled: boolean) =>
  Effect.sync(() => {
    stopBtn.disabled = disabled;
  });

const renderEntries = (entries: Entry[]) =>
  Effect.sync(() => {
    if (entries.length === 0) {
      entriesList.innerHTML =
        '<p class="text-gray-500" data-no-entries>No entries yet. Start tracking!</p>';
      return;
    }

    entriesList.innerHTML = entries.map((entry) => entryHTML(entry)).join("");
  });

const addEntryToList = (entry: Entry) =>
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

const entryHTML = (entry: Entry): string => {
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
};

// Timer display update
const formatElapsedTime = (startedAt: string): string => {
  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;

  const hours = Math.floor(elapsed / (1000 * 60 * 60));
  const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const startTimerUI = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) =>
  Effect.gen(function* () {
    yield* setStartBtnDisabled(true);
    yield* setStopBtnDisabled(false);

    const updateDisplay = Effect.gen(function* () {
      const timer = yield* Ref.get(timerRef);
      if (timer) {
        yield* updateTimerDisplay(formatElapsedTime(timer.startedAt));
      }
    });

    // Update display immediately
    yield* updateDisplay;

    // Clear existing interval if any
    const existingInterval = yield* Ref.get(intervalRef);
    if (existingInterval !== null) {
      clearInterval(existingInterval);
    }

    // Start new interval
    const intervalId = setInterval(() => {
      Effect.runPromise(
        Effect.catchAll(updateDisplay, (error) =>
          Effect.logError(`Timer display update error: ${error}`)
        )
      );
    }, 1000) as unknown as number;

    yield* Ref.set(intervalRef, intervalId);
  });

const stopTimerUI = (intervalRef: Ref.Ref<number | null>) =>
  Effect.gen(function* () {
    yield* setStartBtnDisabled(false);
    yield* setStopBtnDisabled(true);
    yield* updateTimerDisplay("Ready to start");

    const intervalId = yield* Ref.get(intervalRef);
    if (intervalId !== null) {
      clearInterval(intervalId);
      yield* Ref.set(intervalRef, null);
    }
  });

// Offline indicator UI
const showOfflineIndicator = Effect.sync(() => {
  if (offlineIndicator) {
    return;
  }

  offlineIndicator = document.createElement("div");
  offlineIndicator.className =
    "fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded shadow-lg text-sm";
  offlineIndicator.textContent = "Offline";
  document.body.appendChild(offlineIndicator);
});

const hideOfflineIndicator = Effect.sync(() => {
  if (offlineIndicator) {
    offlineIndicator.remove();
    offlineIndicator = null;
  }
});

// Sync functionality
const syncWithServer = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      return;
    }

    const localTimer = yield* getTimerFromLocal();

    // Sync timer if exists locally
    if (localTimer) {
      // Check if server has a timer
      const serverTimer = yield* getTimer;
      if (serverTimer) {
        // If server timer exists and is different, stop it first
        if (serverTimer.startedAt !== localTimer.startedAt) {
          yield* Effect.tryPromise({
            try: () => fetch("/api/timer/stop", { method: "POST" }),
            catch: () => Effect.void,
          });
        } else {
          // Same timer, already synced
          yield* clearLocalTimer();
          return;
        }
      }

      // Start timer on server (server creates new timer with current time)
      // We keep using local timer in UI to preserve original start time
      yield* Effect.tryPromise({
        try: () => fetch("/api/timer/start", { method: "POST" }),
        catch: () => Effect.void,
      });

      // Keep local timer in ref to preserve start time
      yield* Ref.set(timerRef, localTimer);
      yield* startTimerUI(timerRef, intervalRef);
      // Don't clear local timer yet - it will be cleared when stopped online
    }

    // Reload entries after sync
    const entries = yield* getEntries;
    yield* renderEntries(entries);
  });

// Main app initialization
const initializeApp = Effect.gen(function* () {
  const timerRef = yield* Ref.make<Timer | null>(null);
  const intervalRef = yield* Ref.make<number | null>(null);

  // Load initial data
  const loadInitialData = Effect.gen(function* () {
    // Check localStorage first for offline timer
    const localTimer = yield* getTimerFromLocal();
    if (localTimer && !navigator.onLine) {
      yield* Ref.set(timerRef, localTimer);
      yield* startTimerUI(timerRef, intervalRef);
    }

    const timer = yield* getTimer;
    if (timer) {
      yield* Ref.set(timerRef, timer);
      yield* startTimerUI(timerRef, intervalRef);
    }

    const entries = yield* getEntries;
    yield* renderEntries(entries);
  });

  // Set up online/offline listeners
  const updateOnlineStatus = () =>
    Effect.gen(function* () {
      if (navigator.onLine) {
        yield* hideOfflineIndicator;
        // Attempt sync when coming back online
        yield* syncWithServer(timerRef, intervalRef);
      } else {
        yield* showOfflineIndicator;
      }
    });

  // Initial online status
  Effect.runPromise(
    Effect.catchAll(updateOnlineStatus(), (error) =>
      Effect.logError(`Failed to update online status: ${error}`)
    )
  );

  // Listen for online/offline events
  window.addEventListener("online", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle online event: ${error}`)
      )
    );
  });

  window.addEventListener("offline", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle offline event: ${error}`)
      )
    );
  });

  // WebSocket connection
  const ws = new WebSocket(`ws://${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected"));
    Effect.runPromise(
      Effect.catchAll(loadInitialData, (error) =>
        Effect.logError(`Failed to load initial data: ${error}`)
      )
    );
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

    if (message.type === "timer:started") {
      const startedAt = message.data.startedAt;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* Ref.set(timerRef, { startedAt });
            yield* startTimerUI(timerRef, intervalRef);
          }),
          (error) => Effect.logError(`Failed to handle timer:started: ${error}`)
        )
      );
    } else if (message.type === "timer:stopped") {
      const entry = message.data.entry;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* stopTimerUI(intervalRef);
            yield* Ref.set(timerRef, null);
            yield* addEntryToList(entry);
          }),
          (error) => Effect.logError(`Failed to handle timer:stopped: ${error}`)
        )
      );
    }
  };

  ws.onerror = (error) => {
    Effect.runPromise(Effect.logError(`WebSocket error: ${error}`));
  };

  ws.onclose = () => {
    Effect.runPromise(Effect.log("WebSocket disconnected"));
  };

  // Button handlers
  startBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const timer = yield* startTimer;
          yield* Ref.set(timerRef, timer);
          yield* startTimerUI(timerRef, intervalRef);
        }),
        (error) => Effect.logError(`Failed to start timer: ${error}`)
        // Could show user-friendly error message here
      )
    );
  });

  stopBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          yield* stopTimer;
          yield* stopTimerUI(intervalRef);
          yield* Ref.set(timerRef, null);
        }),
        (error) => Effect.logError(`Failed to stop timer: ${error}`)
        // Could show user-friendly error message here
      )
    );
  });
});

// Run the app
Effect.runPromise(
  Effect.catchAll(initializeApp, (error) =>
    Effect.logError(`Failed to initialize app: ${error}`)
  )
);
