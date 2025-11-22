import { Effect, Ref } from "effect";
import { CacheKeys, invalidateCache, setCached } from "~/lib/cache.ts";
import type { Entry, Project, Timer, WebSocketMessage } from "~/lib/types.ts";
import { getEntries } from "../api.ts";
import type { AppRefs } from "../core/app-state.ts";
import { populateProjectCombobox } from "../features/project-management.ts";
import {
  addEntryToList,
  removeEntryFromDOM,
  renderEntries,
  renderEntryView,
} from "../ui/dom.ts";
import { startTimerUI, stopTimerUI } from "../ui/timer-ui.ts";

/**
 * Handles timer started message
 */
const handleTimerStarted = (
  refs: AppRefs,
  startedAt: string,
  projectId?: string
) => {
  const timer: Timer = {
    startedAt,
    ...(projectId ? { projectId } : {}),
  };
  return Effect.catchAll(
    Effect.gen(function* () {
      yield* Ref.set(refs.timerRef, timer);
      yield* Ref.set(refs.selectedProjectIdRef, projectId);
      const currentProjects: Project[] = yield* Ref.get(refs.projectsRef);
      yield* populateProjectCombobox(currentProjects, projectId);
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
      yield* invalidateCache(CacheKeys.timer);
      yield* setCached(CacheKeys.timer, timer);
    }),
    (error) => Effect.logError(`Failed to handle timer:started: ${error}`)
  );
};

/**
 * Handles timer updated message
 */
const handleTimerUpdated = (
  refs: AppRefs,
  startedAt: string,
  projectId?: string
) => {
  const timer: Timer = {
    startedAt,
    ...(projectId ? { projectId } : {}),
  };
  return Effect.catchAll(
    Effect.gen(function* () {
      yield* Ref.set(refs.timerRef, timer);
      yield* Ref.set(refs.selectedProjectIdRef, projectId);
      const currentProjects: Project[] = yield* Ref.get(refs.projectsRef);
      yield* populateProjectCombobox(currentProjects, projectId);
      yield* invalidateCache(CacheKeys.timer);
      yield* setCached(CacheKeys.timer, timer);
    }),
    (error) => Effect.logError(`Failed to handle timer:updated: ${error}`)
  );
};

/**
 * Handles project created message
 */
const handleProjectCreated = (refs: AppRefs, project: Project) =>
  Effect.catchAll(
    Effect.gen(function* () {
      const currentProjects: Project[] = yield* Ref.get(refs.projectsRef);
      const updatedProjects = [...currentProjects, project].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      yield* Ref.set(refs.projectsRef, updatedProjects);
      const pendingId: string | null = yield* Ref.get(refs.pendingProjectIdRef);
      if (pendingId === project.id) {
        yield* Ref.set(refs.pendingProjectIdRef, null);
        yield* Ref.set(refs.selectedProjectIdRef, project.id);
        yield* populateProjectCombobox(updatedProjects, project.id);
      } else {
        const selectedId = yield* Ref.get(refs.selectedProjectIdRef);
        yield* populateProjectCombobox(updatedProjects, selectedId);
      }
      yield* setCached(CacheKeys.projects, updatedProjects);
    }),
    (error) => Effect.logError(`Failed to handle project:created: ${error}`)
  );

/**
 * Handles project updated message
 */
const handleProjectUpdated = (refs: AppRefs, project: Project) =>
  Effect.catchAll(
    Effect.gen(function* () {
      const currentProjects: Project[] = yield* Ref.get(refs.projectsRef);
      const updatedProjects = currentProjects
        .map((p) => (p.id === project.id ? project : p))
        .sort((a, b) => a.name.localeCompare(b.name));
      yield* Ref.set(refs.projectsRef, updatedProjects);
      const selectedId: string | undefined = yield* Ref.get(
        refs.selectedProjectIdRef
      );
      yield* populateProjectCombobox(updatedProjects, selectedId);
      yield* setCached(CacheKeys.projects, updatedProjects);
    }),
    (error) => Effect.logError(`Failed to handle project:updated: ${error}`)
  );

/**
 * Handles project deleted message
 */
const handleProjectDeleted = (refs: AppRefs, id: string) =>
  Effect.catchAll(
    Effect.gen(function* () {
      const currentProjects: Project[] = yield* Ref.get(refs.projectsRef);
      const updatedProjects = currentProjects.filter((p) => p.id !== id);
      yield* Ref.set(refs.projectsRef, updatedProjects);
      const selectedId: string | undefined = yield* Ref.get(
        refs.selectedProjectIdRef
      );
      if (selectedId === id) {
        yield* Ref.set(refs.selectedProjectIdRef, undefined);
      }
      yield* populateProjectCombobox(updatedProjects, selectedId);
      yield* setCached(CacheKeys.projects, updatedProjects);
      yield* invalidateCache(CacheKeys.entries);
      const entries = yield* getEntries;
      yield* renderEntries(entries, updatedProjects);
      yield* setCached(CacheKeys.entries, entries);
    }),
    (error) => Effect.logError(`Failed to handle project:deleted: ${error}`)
  );

/**
 * Handles timer stopped message
 */
const handleTimerStopped = (refs: AppRefs, entry: Entry) =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* stopTimerUI(refs.intervalRef);
      yield* Ref.set(refs.timerRef, null);
      const projects: Project[] = yield* Ref.get(refs.projectsRef);
      yield* addEntryToList(entry, projects);
      yield* invalidateCache([CacheKeys.timer, CacheKeys.entries]);
    }),
    (error) => Effect.logError(`Failed to handle timer:stopped: ${error}`)
  );

/**
 * Handles entry deleted message
 */
const handleEntryDeleted = (_refs: AppRefs, entryId: string) =>
  Effect.catchAll(
    Effect.gen(function* () {
      // Remove from DOM immediately without refetching
      yield* removeEntryFromDOM(entryId);
      // Invalidate cache so next fetch gets fresh data
      yield* invalidateCache(CacheKeys.entries);
    }),
    (error) => Effect.logError(`Failed to handle entry:deleted: ${error}`)
  );

/**
 * Handles entry updated message
 */
const handleEntryUpdated = (refs: AppRefs, entry: Entry) =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* invalidateCache(CacheKeys.entries);
      const projects: Project[] = yield* Ref.get(refs.projectsRef);
      yield* renderEntryView(entry, projects);
    }),
    (error) => Effect.logError(`Failed to handle entry:updated: ${error}`)
  );

/**
 * Creates WebSocket message handler
 */
export const createWebSocketMessageHandler =
  (refs: AppRefs): ((event: MessageEvent) => void) =>
  (event: MessageEvent) => {
    let message: WebSocketMessage;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      Effect.runPromise(
        Effect.logError(`Failed to parse WebSocket message: ${error}`)
      );
      return;
    }

    switch (message.type) {
      case "timer:started":
        Effect.runPromise(
          handleTimerStarted(
            refs,
            message.data.startedAt,
            message.data.projectId
          )
        );
        break;
      case "timer:updated":
        Effect.runPromise(
          handleTimerUpdated(
            refs,
            message.data.startedAt,
            message.data.projectId
          )
        );
        break;
      case "project:created":
        Effect.runPromise(handleProjectCreated(refs, message.data.project));
        break;
      case "project:updated":
        Effect.runPromise(handleProjectUpdated(refs, message.data.project));
        break;
      case "project:deleted":
        Effect.runPromise(handleProjectDeleted(refs, message.data.id));
        break;
      case "timer:stopped":
        Effect.runPromise(handleTimerStopped(refs, message.data.entry));
        break;
      case "entry:deleted":
        Effect.runPromise(handleEntryDeleted(refs, message.data.id));
        break;
      case "entry:updated":
        Effect.runPromise(handleEntryUpdated(refs, message.data.entry));
        break;
      default:
        break;
    }
  };

/**
 * Creates and configures WebSocket connection
 * @param loadInitialData - Optional effect to run on WebSocket open. If null, no fetch is performed.
 */
export const createWebSocket = (
  refs: AppRefs,
  loadInitialData: Effect.Effect<void, Error> | null
): WebSocket => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected"));
    // Only fetch if loadInitialData is provided (skip on initial page load)
    if (loadInitialData) {
      Effect.runPromise(
        Effect.catchAll(loadInitialData, (error) =>
          Effect.logError(`Failed to load initial data: ${error}`)
        )
      );
    }
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
