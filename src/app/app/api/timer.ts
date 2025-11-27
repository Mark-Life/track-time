import { Effect } from "effect";
import { CacheKeys, invalidateCache, setCached } from "~/lib/cache";
import { validateEntryDuration } from "~/lib/entry-validation";
import {
  clearLocalTimer,
  getTimerFromLocal,
  saveEntryToLocal,
  saveTimerToLocal,
} from "~/lib/local-storage";
import type { Entry, Timer } from "~/lib/types";

import {
  getCsrfTokenFromCookie,
  handleAuthError,
  handleCsrfError,
} from "./auth";

export const startTimer = (startedAt?: string, projectId?: string) =>
  Effect.gen(function* () {
    const timerStartedAt = startedAt ?? new Date().toISOString();
    const timer: Timer = {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };

    if (!navigator.onLine) {
      yield* saveTimerToLocal(timer);
      // Update cache to keep it in sync with localStorage
      yield* invalidateCache(CacheKeys.timer);
      yield* setCached(CacheKeys.timer, timer);
      return timer;
    }

    const makeStartRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch("/api/timer/start", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({
              startedAt: timerStartedAt,
              ...(projectId ? { projectId } : {}),
            }),
          });
        },
        catch: (error) => {
          Effect.runSync(saveTimerToLocal(timer));
          return new Error(`Failed to start timer: ${error}`);
        },
      });

    const csrfToken = getCsrfTokenFromCookie();
    let timerResponse = yield* makeStartRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (timerResponse.status === 403) {
      timerResponse = yield* handleCsrfError(timerResponse, (newCsrfToken) =>
        makeStartRequest(newCsrfToken)
      );
    }

    if (!timerResponse.ok) {
      handleAuthError(timerResponse);
      yield* saveTimerToLocal(timer);
      return timer;
    }

    const serverTimer: Timer = yield* Effect.tryPromise({
      try: () => timerResponse.json() as Promise<Timer>,
      catch: (error) => {
        Effect.runSync(saveTimerToLocal(timer));
        return new Error(`Failed to parse timer JSON: ${error}`);
      },
    });

    // Invalidate timer cache and update it with new value
    yield* invalidateCache(CacheKeys.timer);
    yield* setCached(CacheKeys.timer, serverTimer);

    return serverTimer;
  });

export const stopTimer = Effect.gen(function* () {
  // Get timer from local storage or server
  // Prioritize local timer if it exists (preserves original start time)
  const localTimer = yield* getTimerFromLocal();
  let timer: Timer | null = localTimer;

  if (!timer && navigator.onLine) {
    const serverTimer = yield* getTimer; // ?????
    timer = serverTimer;
  }

  if (!timer) {
    return yield* Effect.fail(new Error("No active timer"));
  }

  const endedAt = new Date().toISOString();
  yield* validateEntryDuration(timer.startedAt, endedAt);

  const startTime = new Date(timer.startedAt).getTime();
  const endTime = new Date(endedAt).getTime();
  const duration = (endTime - startTime) / (1000 * 60 * 60);

  const entry: Entry = {
    id: crypto.randomUUID(),
    startedAt: timer.startedAt,
    endedAt,
    duration,
    ...(timer.projectId ? { projectId: timer.projectId } : {}),
  };

  if (!navigator.onLine) {
    yield* saveEntryToLocal(entry);
    yield* clearLocalTimer();
    // Invalidate timer cache to prevent stale data
    yield* invalidateCache(CacheKeys.timer);
    return entry;
  }

  const makeStopRequest = (token: string | null) =>
    Effect.tryPromise({
      try: () => {
        const headers: Record<string, string> = {};
        if (token) {
          headers["X-CSRF-Token"] = token;
        }
        return fetch("/api/timer/stop", {
          method: "POST",
          headers,
          credentials: "include",
        });
      },
      catch: (error) => {
        Effect.runSync(saveEntryToLocal(entry));
        Effect.runSync(clearLocalTimer());
        return new Error(`Failed to stop timer: ${error}`);
      },
    });

  const csrfToken = getCsrfTokenFromCookie();
  let stopResponse = yield* makeStopRequest(csrfToken);

  // Handle CSRF error (403) by refreshing token and retrying
  if (stopResponse.status === 403) {
    stopResponse = yield* handleCsrfError(stopResponse, (newCsrfToken) =>
      makeStopRequest(newCsrfToken)
    );
  }

  if (!stopResponse.ok) {
    handleAuthError(stopResponse);
    yield* saveEntryToLocal(entry);
    yield* clearLocalTimer();
    return entry;
  }

  const serverEntry: Entry = yield* Effect.tryPromise({
    try: () => stopResponse.json() as Promise<Entry>,
    catch: (error) => {
      Effect.runSync(saveEntryToLocal(entry));
      Effect.runSync(clearLocalTimer());
      return new Error(`Failed to parse entry JSON: ${error}`);
    },
  });

  yield* clearLocalTimer();
  // Invalidate timer and entries cache
  yield* invalidateCache([CacheKeys.timer, CacheKeys.entries]);
  return serverEntry;
});

export const updateTimer = (projectId?: string) =>
  Effect.gen(function* () {
    yield* Effect.log(
      `updateTimer called with projectId: ${projectId ?? "undefined"}`
    );
    // Get current timer to preserve startedAt
    const currentTimer = navigator.onLine
      ? yield* getTimer
      : yield* getTimerFromLocal();

    if (!currentTimer) {
      yield* Effect.log("No active timer found, cannot update");
      return yield* Effect.fail(new Error("No active timer"));
    }

    yield* Effect.log(
      `Current timer found: startedAt=${currentTimer.startedAt}, projectId=${currentTimer.projectId ?? "none"}`
    );

    const timer: Timer = {
      startedAt: currentTimer.startedAt,
      ...(projectId ? { projectId } : {}),
    };

    if (!navigator.onLine) {
      yield* saveTimerToLocal(timer);
      return timer;
    }

    yield* Effect.log(
      `Making PUT request to /api/timer/update with projectId: ${projectId ?? "undefined"}`
    );

    const makeUpdateRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch("/api/timer/update", {
            method: "PUT",
            headers,
            credentials: "include",
            body: JSON.stringify({
              ...(projectId ? { projectId } : {}),
            }),
          });
        },
        catch: (error) => {
          Effect.runSync(saveTimerToLocal(timer));
          return new Error(`Failed to update timer: ${error}`);
        },
      });

    const csrfToken = getCsrfTokenFromCookie();
    let updateResponse = yield* makeUpdateRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (updateResponse.status === 403) {
      updateResponse = yield* handleCsrfError(updateResponse, (newCsrfToken) =>
        makeUpdateRequest(newCsrfToken)
      );
    }

    if (!updateResponse.ok) {
      handleAuthError(updateResponse);
      yield* saveTimerToLocal(timer);
      return timer;
    }

    const serverTimer: Timer = yield* Effect.tryPromise({
      try: () => updateResponse.json() as Promise<Timer>,
      catch: (error) => {
        Effect.runSync(saveTimerToLocal(timer));
        return new Error(`Failed to parse timer JSON: ${error}`);
      },
    });

    // Update local storage with server timer
    yield* saveTimerToLocal(serverTimer);
    // Invalidate timer cache and update it with new value
    yield* invalidateCache(CacheKeys.timer);
    yield* setCached(CacheKeys.timer, serverTimer);
    return serverTimer;
  });
