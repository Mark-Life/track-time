import { Effect } from "effect";
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

export const getTimer = Effect.gen(function* () {
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

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/timer/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startedAt: timerStartedAt,
            ...(projectId ? { projectId } : {}),
          }),
        }),
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

export const getEntries = Effect.gen(function* () {
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

export const updateEntry = (
  id: string,
  startedAt: string,
  endedAt: string,
  projectId?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    const startTime = new Date(startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    if (duration < 0) {
      yield* Effect.fail(new Error("End time must be after start time"));
    }

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

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`/api/entries/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startedAt,
            endedAt,
            ...(projectId ? { projectId } : {}),
          }),
        }),
      catch: (error) => {
        Effect.runSync(updateLocalEntry(entry));
        return new Error(`Failed to update entry: ${error}`);
      },
    });

    if (!response.ok) {
      yield* updateLocalEntry(entry);
      return entry;
    }

    const serverEntry = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Entry>,
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

    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/entries/${id}`, { method: "DELETE" }),
      catch: (error) => {
        Effect.runSync(clearSyncedEntry(id));
        return new Error(`Failed to delete entry: ${error}`);
      },
    });

    if (!response.ok) {
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
    try: () => fetch("/api/projects"),
    catch: (error) => new Error(`Failed to fetch projects: ${error}`),
  });

  if (!response.ok) {
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

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      catch: (error) => new Error(`Failed to create project: ${error}`),
    });

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to create project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }

    const project = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    return project;
  });

export const updateProject = (id: string, name: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* Effect.fail(new Error("Cannot update project while offline"));
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      catch: (error) => new Error(`Failed to update project: ${error}`),
    });

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to update project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }

    const project = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    return project;
  });

export const deleteProject = (id: string, deleteEntries: boolean) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      yield* Effect.fail(new Error("Cannot delete project while offline"));
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`/api/projects/${id}?deleteEntries=${deleteEntries}`, {
          method: "DELETE",
        }),
      catch: (error) => new Error(`Failed to delete project: ${error}`),
    });

    if (!response.ok) {
      const errorData = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to delete project" }),
      });
      yield* Effect.fail(new Error(errorData.error));
    }
  });
