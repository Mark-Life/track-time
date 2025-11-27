import { Effect } from "effect";
import {
  CacheKeys,
  getCached,
  getCachedWithRevalidate,
  invalidateCache,
} from "~/lib/cache";
import { validateEntryDuration } from "~/lib/entry-validation";
import {
  clearSyncedEntry,
  getLocalEntries,
  saveEntryToLocal,
  updateLocalEntry,
} from "~/lib/local-storage";
import type { Entry } from "~/lib/types";

import {
  getCsrfTokenFromCookie,
  handleAuthError,
  handleCsrfError,
} from "./auth";

export const getEntries = Effect.gen(function* () {
  const localEntries = yield* getLocalEntries();

  // Check cache for server entries (works both online and offline)
  const cachedServerEntries = yield* getCached<Entry[]>(CacheKeys.entries);
  const serverEntries = cachedServerEntries ?? [];

  if (!navigator.onLine) {
    // When offline, merge cached server entries with local entries
    // Remove duplicates by ID (local entries take precedence if duplicate)
    const serverIds = new Set(serverEntries.map((e) => e.id));
    const uniqueLocalEntries = localEntries.filter((e) => !serverIds.has(e.id));
    return [...serverEntries, ...uniqueLocalEntries].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  // Use stale-while-revalidate: return cached immediately, fetch fresh in background
  const freshServerEntries: Entry[] = yield* getCachedWithRevalidate(
    CacheKeys.entries,
    () =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch("/api/entries", { credentials: "include" }),
          catch: (error) => new Error(`Failed to fetch entries: ${error}`),
        });

        if (!response.ok) {
          handleAuthError(response);
          return serverEntries;
        }

        const entries = yield* Effect.tryPromise({
          try: () => response.json() as Promise<Entry[]>,
          catch: (error) => new Error(`Failed to parse entries JSON: ${error}`),
        });

        return entries;
      })
  );

  // Merge local and server entries, removing duplicates by ID
  const serverIds = new Set(freshServerEntries.map((e) => e.id));
  const uniqueLocalEntries = localEntries.filter((e) => !serverIds.has(e.id));
  return [...freshServerEntries, ...uniqueLocalEntries].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
});

export const createEntry = (
  startedAt: string,
  endedAt: string,
  projectId?: string,
  id?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    yield* validateEntryDuration(startedAt, endedAt);

    const startTime = new Date(startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    const entry: Entry = {
      id: id ?? crypto.randomUUID(),
      startedAt,
      endedAt,
      duration,
      ...(projectId ? { projectId } : {}),
    };

    if (!navigator.onLine) {
      yield* saveEntryToLocal(entry);
      return entry;
    }

    const makeCreateRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch("/api/entries", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({
              startedAt,
              endedAt,
              ...(projectId ? { projectId } : {}),
              ...(id ? { id } : {}),
            }),
          });
        },
        catch: (error) => {
          Effect.runSync(saveEntryToLocal(entry));
          return new Error(`Failed to create entry: ${error}`);
        },
      });

    const csrfToken = getCsrfTokenFromCookie();
    let createResponse = yield* makeCreateRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (createResponse.status === 403) {
      createResponse = yield* handleCsrfError(createResponse, (newCsrfToken) =>
        makeCreateRequest(newCsrfToken)
      );
    }

    if (!createResponse.ok) {
      handleAuthError(createResponse);
      yield* saveEntryToLocal(entry);
      return entry;
    }

    const serverEntry: Entry = yield* Effect.tryPromise({
      try: () => createResponse.json() as Promise<Entry>,
      catch: (error) => {
        Effect.runSync(saveEntryToLocal(entry));
        return new Error(`Failed to parse entry JSON: ${error}`);
      },
    });

    // Invalidate entries cache
    yield* invalidateCache(CacheKeys.entries);
    return serverEntry;
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
    // Invalidate entries cache
    yield* invalidateCache(CacheKeys.entries);
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
    // Invalidate entries cache
    yield* invalidateCache(CacheKeys.entries);
  });
