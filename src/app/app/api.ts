import { Effect } from "effect";
import { validateEntryDuration } from "~/lib/entry-validation.ts";
import {
  clearLocalTimer,
  clearSyncedEntry,
  getLocalEntries,
  getTimerFromLocal,
  saveEntryToLocal,
  saveTimerToLocal,
  updateLocalEntry,
} from "~/lib/local-storage.ts";
import type { Entry, Project, Timer } from "~/lib/types.ts";

/**
 * Gets CSRF token from cookies.
 */
const getCsrfTokenFromCookie = (): string | null => {
  const cookies = document.cookie.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name === "csrf-token" && valueParts.length > 0) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return null;
};

/**
 * Fetches a new CSRF token from the server.
 */
const refreshCsrfToken = (): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const response: Response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/csrf-token", {
          method: "GET",
          credentials: "include",
        }),
      catch: (error) => new Error(`Failed to fetch CSRF token: ${error}`),
    });

    if (!response.ok) {
      yield* Effect.fail(new Error("Failed to refresh CSRF token"));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ csrfToken: string }>,
      catch: (error) =>
        new Error(`Failed to parse CSRF token response: ${error}`),
    });

    return data.csrfToken;
  });

/**
 * Handles authentication errors (401) by redirecting to login.
 */
const handleAuthError = (response: Response): void => {
  if (response.status === 401) {
    window.location.href = "/login";
  }
};

/**
 * Handles CSRF errors (403) by refreshing the token and retrying the request.
 * Returns the retried response.
 */
const handleCsrfError = (
  response: Response,
  retryFn: (csrfToken: string) => Effect.Effect<Response, Error>
): Effect.Effect<Response, Error> =>
  Effect.gen(function* () {
    if (response.status !== 403) {
      yield* Effect.fail(new Error(`Unexpected status: ${response.status}`));
    }

    // Refresh CSRF token
    const newCsrfToken = yield* refreshCsrfToken();

    // Retry the request with the new token
    return yield* retryFn(newCsrfToken);
  });

export const getTimer = Effect.gen(function* () {
  if (!navigator.onLine) {
    const localTimer = yield* getTimerFromLocal();
    return localTimer;
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/timer", { credentials: "include" }),
    catch: (error) => new Error(`Failed to fetch timer: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    const localTimer = yield* getTimerFromLocal();
    return localTimer;
  }

  const timer = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Timer | null>,
    catch: (error) => new Error(`Failed to parse timer JSON: ${error}`),
  });

  return timer;
});

export const startTimer = (startedAt?: string, projectId?: string) =>
  Effect.gen(function* () {
    const timerStartedAt = startedAt ?? new Date().toISOString();
    const timer: Timer = {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };

    if (!navigator.onLine) {
      yield* saveTimerToLocal(timer);
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

    return serverTimer;
  });

export const stopTimer = Effect.gen(function* () {
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
      yield* Effect.fail(new Error("No active timer"));
      return;
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
    return serverTimer;
  });

export const getEntries = Effect.gen(function* () {
  const localEntries = yield* getLocalEntries();

  if (!navigator.onLine) {
    // Sort entries by start time (newest first) even when offline
    return localEntries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/entries", { credentials: "include" }),
    catch: (error) => new Error(`Failed to fetch entries: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
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

export const updateEntry = (
  id: string,
  startedAt: string,
  endedAt: string,
  projectId?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    yield* validateEntryDuration(startedAt, endedAt);

    const startTime = new Date(startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    const entry: Entry = {
      id,
      startedAt,
      endedAt,
      duration,
      ...(projectId ? { projectId } : {}),
    };

    if (!navigator.onLine) {
      yield* updateLocalEntry(entry);
      return entry;
    }

    const makeUpdateRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/entries/${id}`, {
            method: "PUT",
            headers,
            credentials: "include",
            body: JSON.stringify({
              startedAt,
              endedAt,
              ...(projectId ? { projectId } : {}),
            }),
          });
        },
        catch: (error) => {
          Effect.runSync(updateLocalEntry(entry));
          return new Error(`Failed to update entry: ${error}`);
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
      yield* updateLocalEntry(entry);
      return entry;
    }

    const serverEntry: Entry = yield* Effect.tryPromise({
      try: () => updateResponse.json() as Promise<Entry>,
      catch: (error) => {
        Effect.runSync(updateLocalEntry(entry));
        return new Error(`Failed to parse entry JSON: ${error}`);
      },
    });

    // Update localStorage with server entry
    yield* updateLocalEntry(serverEntry);
    return serverEntry;
  });

export const deleteEntry = (id: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* clearSyncedEntry(id);
      return;
    }

    const makeDeleteEntryRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {};
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/entries/${id}`, {
            method: "DELETE",
            headers,
            credentials: "include",
          });
        },
        catch: (error) => {
          Effect.runSync(clearSyncedEntry(id));
          return new Error(`Failed to delete entry: ${error}`);
        },
      });

    const csrfToken = getCsrfTokenFromCookie();
    let deleteResponse = yield* makeDeleteEntryRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (deleteResponse.status === 403) {
      deleteResponse = yield* handleCsrfError(deleteResponse, (newCsrfToken) =>
        makeDeleteEntryRequest(newCsrfToken)
      );
    }

    if (!deleteResponse.ok) {
      handleAuthError(deleteResponse);
      yield* clearSyncedEntry(id);
      return;
    }

    // Also remove from localStorage if it exists there
    yield* clearSyncedEntry(id);
  });

export const getProjects = Effect.gen(function* () {
  if (!navigator.onLine) {
    // Return empty array if offline - projects are server-only for now
    return [];
  }

  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/projects", { credentials: "include" }),
    catch: (error) => new Error(`Failed to fetch projects: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    return [];
  }

  const projects = yield* Effect.tryPromise({
    try: () => response.json() as Promise<Project[]>,
    catch: (error) => new Error(`Failed to parse projects JSON: ${error}`),
  });

  return projects;
});

export const createProject = (name: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* Effect.fail(new Error("Cannot create project while offline"));
    }

    const makeCreateProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch("/api/projects", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ name }),
          });
        },
        catch: (error) => new Error(`Failed to create project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let createResponse: Response = yield* makeCreateProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (createResponse.status === 403) {
      createResponse = yield* handleCsrfError(createResponse, (newCsrfToken) =>
        makeCreateProjectRequest(newCsrfToken)
      );
    }

    if (!createResponse.ok) {
      handleAuthError(createResponse);
      const errorData = yield* Effect.tryPromise({
        try: () => createResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to create project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }

    const project: Project = yield* Effect.tryPromise({
      try: () => createResponse.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    return project;
  });

export const updateProject = (id: string, name: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* Effect.fail(new Error("Cannot update project while offline"));
    }

    const makeUpdateProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/projects/${id}`, {
            method: "PUT",
            headers,
            credentials: "include",
            body: JSON.stringify({ name }),
          });
        },
        catch: (error) => new Error(`Failed to update project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let updateResponse: Response = yield* makeUpdateProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (updateResponse.status === 403) {
      updateResponse = yield* handleCsrfError(updateResponse, (newCsrfToken) =>
        makeUpdateProjectRequest(newCsrfToken)
      );
    }

    if (!updateResponse.ok) {
      handleAuthError(updateResponse);
      const errorData = yield* Effect.tryPromise({
        try: () => updateResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to update project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }

    const project: Project = yield* Effect.tryPromise({
      try: () => updateResponse.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    return project;
  });

export const deleteProject = (id: string, deleteEntries: boolean) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* Effect.fail(new Error("Cannot delete project while offline"));
    }

    const makeDeleteProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {};
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/projects/${id}?deleteEntries=${deleteEntries}`, {
            method: "DELETE",
            headers,
            credentials: "include",
          });
        },
        catch: (error) => new Error(`Failed to delete project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let deleteResponse: Response = yield* makeDeleteProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (deleteResponse.status === 403) {
      deleteResponse = yield* handleCsrfError(deleteResponse, (newCsrfToken) =>
        makeDeleteProjectRequest(newCsrfToken)
      );
    }

    if (!deleteResponse.ok) {
      handleAuthError(deleteResponse);
      const errorData = yield* Effect.tryPromise({
        try: () => deleteResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to delete project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }
  });

export const getCurrentUser = Effect.gen(function* () {
  if (!navigator.onLine) {
    yield* Effect.fail(new Error("Cannot get user while offline"));
  }

  const response: Response = yield* Effect.tryPromise({
    try: () => fetch("/api/auth/me", { credentials: "include" }),
    catch: (error) => new Error(`Failed to fetch user: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    yield* Effect.fail(new Error("Failed to get current user"));
  }

  const data = yield* Effect.tryPromise({
    try: () =>
      response.json() as Promise<{
        user: { id: string; email: string; createdAt: string };
      }>,
    catch: (error) => new Error(`Failed to parse user JSON: ${error}`),
  });

  return data.user;
});

export const logout = Effect.gen(function* () {
  if (!navigator.onLine) {
    yield* Effect.fail(new Error("Cannot logout while offline"));
  }

  const response: Response = yield* Effect.tryPromise({
    try: () =>
      fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }),
    catch: (error) => new Error(`Failed to logout: ${error}`),
  });

  if (!response.ok) {
    handleAuthError(response);
    yield* Effect.fail(new Error("Failed to logout"));
  }

  // Redirect to login page after successful logout
  window.location.href = "/login";
});
