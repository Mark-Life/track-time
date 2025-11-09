import "~/global.css";
import { Effect, Ref } from "effect";
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

// API functions
const getTimer = Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer"),
    catch: (error) => new Error(`Failed to fetch timer: ${error}`),
  });

  if (!response.ok) {
    yield* Effect.fail(
      new Error(`Failed to get timer: HTTP ${response.status}`)
    );
  }

  const timer = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Timer | null>,
    catch: (error) => new Error(`Failed to parse timer JSON: ${error}`),
  });

  return timer;
});

const startTimer = Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer/start", { method: "POST" }),
    catch: (error) => new Error(`Failed to start timer: ${error}`),
  });

  if (!response.ok) {
    yield* Effect.fail(
      new Error(`Failed to start timer: HTTP ${response.status}`)
    );
  }

  const timer = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Timer>,
    catch: (error) => new Error(`Failed to parse timer JSON: ${error}`),
  });

  return timer;
});

const stopTimer = Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer/stop", { method: "POST" }),
    catch: (error) => new Error(`Failed to stop timer: ${error}`),
  });

  if (!response.ok) {
    yield* Effect.fail(
      new Error(`Failed to stop timer: HTTP ${response.status}`)
    );
  }

  return response.ok;
});

const getEntries = Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/entries"),
    catch: (error) => new Error(`Failed to fetch entries: ${error}`),
  });

  if (!response.ok) {
    yield* Effect.fail(
      new Error(`Failed to get entries: HTTP ${response.status}`)
    );
  }

  const entries = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Entry[]>,
    catch: (error) => new Error(`Failed to parse entries JSON: ${error}`),
  });

  return entries;
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

// Main app initialization
const initializeApp = Effect.gen(function* () {
  const timerRef = yield* Ref.make<Timer | null>(null);
  const intervalRef = yield* Ref.make<number | null>(null);

  // Load initial data
  const loadInitialData = Effect.gen(function* () {
    const timer = yield* getTimer;
    if (timer) {
      yield* Ref.set(timerRef, timer);
      yield* startTimerUI(timerRef, intervalRef);
    }

    const entries = yield* getEntries;
    yield* renderEntries(entries);
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
