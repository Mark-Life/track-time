import { Effect, Ref } from "effect";
import { CacheKeys, invalidateCache, setCached } from "~/lib/cache.ts";
import type { Project, Timer, WebSocketMessage } from "~/lib/types.ts";
import { getEntries } from "./api.ts";
import {
  addEntryToList,
  renderEntries,
  renderEntryView,
} from "./dom.ts";
import { startTimerUI, stopTimerUI } from "./timer-ui.ts";
import {
  populateProjectCombobox,
  type AppRefs,
} from "./project-management.ts";

/**
 * Creates WebSocket message handler
 */
export const createWebSocketMessageHandler = (
  refs: AppRefs
): ((event: MessageEvent) => void) => {
  return (event: MessageEvent) => {
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
      const projectId = message.data.projectId;
      const timer: Timer = {
        startedAt,
        ...(projectId ? { projectId } : {}),
      };
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* Ref.set(refs.timerRef, timer);
            yield* Ref.set(refs.selectedProjectIdRef, projectId);
            const currentProjects = yield* Ref.get(refs.projectsRef);
            yield* populateProjectCombobox(currentProjects, projectId);
            yield* startTimerUI(refs.timerRef, refs.intervalRef);
            // Invalidate timer cache and update it
            yield* invalidateCache(CacheKeys.timer);
            yield* setCached(CacheKeys.timer, timer);
          }),
          (error) => Effect.logError(`Failed to handle timer:started: ${error}`)
        )
      );
    } else if (message.type === "timer:updated") {
      const startedAt = message.data.startedAt;
      const projectId = message.data.projectId;
      const timer: Timer = {
        startedAt,
        ...(projectId ? { projectId } : {}),
      };
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* Ref.set(refs.timerRef, timer);
            yield* Ref.set(refs.selectedProjectIdRef, projectId);
            const currentProjects = yield* Ref.get(refs.projectsRef);
            yield* populateProjectCombobox(currentProjects, projectId);
            // Invalidate timer cache and update it
            yield* invalidateCache(CacheKeys.timer);
            yield* setCached(CacheKeys.timer, timer);
          }),
          (error) => Effect.logError(`Failed to handle timer:updated: ${error}`)
        )
      );
    } else if (message.type === "project:created") {
      const project = message.data.project;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const currentProjects = yield* Ref.get(refs.projectsRef);
            const updatedProjects = [...currentProjects, project].sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            yield* Ref.set(refs.projectsRef, updatedProjects);
            const pendingId = yield* Ref.get(refs.pendingProjectIdRef);
            // If this is the project we just created, select it
            if (pendingId === project.id) {
              yield* Ref.set(refs.pendingProjectIdRef, null);
              yield* Ref.set(refs.selectedProjectIdRef, project.id);
              yield* populateProjectCombobox(updatedProjects, project.id);
            } else {
              const selectedId = yield* Ref.get(refs.selectedProjectIdRef);
              yield* populateProjectCombobox(updatedProjects, selectedId);
            }
            // Update cache with fresh data (optimistic update)
            yield* setCached(CacheKeys.projects, updatedProjects);
          }),
          (error) =>
            Effect.logError(`Failed to handle project:created: ${error}`)
        )
      );
    } else if (message.type === "project:updated") {
      const project = message.data.project;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const currentProjects = yield* Ref.get(refs.projectsRef);
            const updatedProjects = currentProjects
              .map((p) => (p.id === project.id ? project : p))
              .sort((a, b) => a.name.localeCompare(b.name));
            yield* Ref.set(refs.projectsRef, updatedProjects);
            const selectedId = yield* Ref.get(refs.selectedProjectIdRef);
            yield* populateProjectCombobox(updatedProjects, selectedId);
            // Update cache with fresh data (optimistic update)
            yield* setCached(CacheKeys.projects, updatedProjects);
          }),
          (error) =>
            Effect.logError(`Failed to handle project:updated: ${error}`)
        )
      );
    } else if (message.type === "project:deleted") {
      const id = message.data.id;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const currentProjects = yield* Ref.get(refs.projectsRef);
            const updatedProjects = currentProjects.filter((p) => p.id !== id);
            yield* Ref.set(refs.projectsRef, updatedProjects);
            const selectedId = yield* Ref.get(refs.selectedProjectIdRef);
            if (selectedId === id) {
              yield* Ref.set(refs.selectedProjectIdRef, undefined);
            }
            yield* populateProjectCombobox(updatedProjects, selectedId);
            // Update projects cache with fresh data
            yield* setCached(CacheKeys.projects, updatedProjects);
            // Invalidate entries cache and reload
            yield* invalidateCache(CacheKeys.entries);
            const entries = yield* getEntries;
            yield* renderEntries(entries, updatedProjects);
            // Update entries cache with fresh data
            yield* setCached(CacheKeys.entries, entries);
          }),
          (error) =>
            Effect.logError(`Failed to handle project:deleted: ${error}`)
        )
      );
    } else if (message.type === "timer:stopped") {
      const entry = message.data.entry;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* stopTimerUI(refs.intervalRef);
            yield* Ref.set(refs.timerRef, null);
            const projects = yield* Ref.get(refs.projectsRef);
            yield* addEntryToList(entry, projects);
            // Invalidate timer and entries cache
            yield* invalidateCache([CacheKeys.timer, CacheKeys.entries]);
          }),
          (error) => Effect.logError(`Failed to handle timer:stopped: ${error}`)
        )
      );
    } else if (message.type === "entry:deleted") {
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            // Invalidate entries cache and fetch fresh data
            yield* invalidateCache(CacheKeys.entries);
            const entries = yield* getEntries;
            const projects = yield* Ref.get(refs.projectsRef);
            yield* renderEntries(entries, projects);
            // Update cache with fresh entries
            yield* setCached(CacheKeys.entries, entries);
          }),
          (error) => Effect.logError(`Failed to handle entry:deleted: ${error}`)
        )
      );
    } else if (message.type === "entry:updated") {
      const entry = message.data.entry;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            // Invalidate entries cache to ensure fresh data on next fetch
            yield* invalidateCache(CacheKeys.entries);
            const projects = yield* Ref.get(refs.projectsRef);
            yield* renderEntryView(entry, projects);
            // Note: We don't update cache here because we only have one entry
            // The cache will be updated on next getEntries() call
          }),
          (error) => Effect.logError(`Failed to handle entry:updated: ${error}`)
        )
      );
    }
  };
};

/**
 * Creates and configures WebSocket connection
 */
export const createWebSocket = (
  refs: AppRefs,
  loadInitialData: Effect.Effect<void, Error>
): WebSocket => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected"));
    Effect.runPromise(
      Effect.catchAll(loadInitialData, (error) =>
        Effect.logError(`Failed to load initial data: ${error}`)
      )
    );
  };

  ws.onmessage = createWebSocketMessageHandler(refs);

  ws.onerror = (error) => {
    Effect.runPromise(Effect.logError(`WebSocket error: ${error}`));
  };

  ws.onclose = () => {
    Effect.runPromise(Effect.log("WebSocket disconnected"));
  };

  return ws;
};

