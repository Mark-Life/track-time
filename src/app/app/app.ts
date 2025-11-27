import "~/global.css";
import { Effect, Ref } from "effect";
import { initializeDrawer } from "~/components/ui/drawer";
import { CacheKeys, getCached, setCached } from "~/lib/cache";
import { getLocalEntries, getTimerFromLocal } from "~/lib/local-storage";
import type { Entry, Project, Timer } from "~/lib/types";
import { createProject, getEntries } from "./api";

/**
 * Handles authentication errors (401) by redirecting to login.
 */
const handleAuthError = (response: Response): void => {
  if (response.status === 401) {
    window.location.href = "/login";
  }
};

import {
  type AppRefs,
  appInitialized,
  appRefs,
  createAppRefs,
  setupCleanupListeners,
  setWebSocketInstance,
} from "./core/app-state";
import { initializeRouting } from "./core/routing";
import {
  initializeProjectCombobox,
  populateProjectCombobox,
  setupProjectCreationHandlers,
} from "./features/project-management";
import { loadUserEmail, setupLogout } from "./features/user-management";
import {
  setupEntryClickHandlers,
  setupEntryFormHandler,
} from "./infra/entry-handlers";
import { setupOnlineStatusListeners } from "./infra/online-status";
import { setupTimerButtonHandler } from "./infra/timer-handlers";
import { createWebSocket } from "./infra/websocket-handlers";
import { renderEntries, showEntriesLoading, showPlayButton } from "./ui/dom";
import {
  addProjectBtn,
  entriesList,
  playPauseBtn,
  projectInputContainer,
  projectNameInput,
  projectSubmitBtn,
} from "./ui/dom-elements";
import { startTimerUI } from "./ui/timer-ui";

// Accept HMR updates
if (import.meta.hot) {
  import.meta.hot.accept();
}

/**
 * Shows shell UI immediately (skeleton states already in HTML)
 * This provides instant visual feedback before data loads
 */
const showShellUI = Effect.sync(() => {
  // Skeleton is already in HTML, just ensure it's visible
  // The shell is rendered immediately on page load
});

/**
 * Loads entries for timer page (can be called independently)
 */
const loadEntriesForTimerPage = Effect.gen(function* () {
  if (!appRefs) {
    return;
  }
  yield* showEntriesLoading();
  const entries = yield* getEntries;
  const currentProjects = yield* Ref.get(appRefs.projectsRef);
  yield* renderEntries(entries, currentProjects);
});

/**
 * Main app initialization
 */
const initializeApp = Effect.gen(function* () {
  // Show shell UI immediately (skeleton already in HTML)
  yield* showShellUI;

  // Initialize drawer
  yield* initializeDrawer();

  // Setup logout button (non-blocking)
  setupLogout();

  // Defer user email loading (non-critical, runs after initial render)
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => {
      Effect.runPromise(
        Effect.catchAll(loadUserEmail, (error) =>
          Effect.logError(`Failed to load user email: ${error}`)
        )
      );
    });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      Effect.runPromise(
        Effect.catchAll(loadUserEmail, (error) =>
          Effect.logError(`Failed to load user email: ${error}`)
        )
      );
    }, 100);
  }

  // Use existing refs if already initialized, otherwise create new ones
  let refs: AppRefs;

  if (appInitialized && appRefs) {
    // Already initialized, use existing refs and just load entries
    refs = appRefs;
    yield* loadEntriesForTimerPage;
    return;
  }

  // Create new refs for first-time initialization
  refs = yield* createAppRefs;

  // Initialize project combobox
  yield* initializeProjectCombobox(refs.timerRef, refs.selectedProjectIdRef);

  // Load cached data first for instant render
  const loadCachedData = Effect.gen(function* () {
    // Load cached projects
    const cachedProjects = yield* getCached<Project[]>(CacheKeys.projects);
    if (cachedProjects) {
      yield* Ref.set(refs.projectsRef, cachedProjects);
      yield* populateProjectCombobox(cachedProjects);
    }

    // Load cached timer
    const cachedTimer = yield* getCached<Timer | null>(CacheKeys.timer);
    if (cachedTimer) {
      yield* Ref.set(refs.timerRef, cachedTimer);
      yield* Ref.set(refs.selectedProjectIdRef, cachedTimer.projectId);
      yield* populateProjectCombobox(
        cachedProjects || [],
        cachedTimer.projectId
      );
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
    } else {
      // Check localStorage for offline timer
      const localTimer = yield* getTimerFromLocal();
      if (localTimer && !navigator.onLine) {
        yield* Ref.set(refs.timerRef, localTimer);
        yield* Ref.set(refs.selectedProjectIdRef, localTimer.projectId);
        yield* populateProjectCombobox(
          cachedProjects || [],
          localTimer.projectId
        );
        yield* startTimerUI(refs.timerRef, refs.intervalRef);
      } else {
        yield* showPlayButton();
      }
    }

    // Load cached entries
    const cachedEntries = yield* getCached<Entry[]>(CacheKeys.entries);
    if (cachedEntries) {
      yield* renderEntries(cachedEntries, cachedProjects || []);
    } else {
      // Show loading skeleton if no cached entries
      yield* showEntriesLoading();
    }
  });

  // Load cached data immediately
  yield* loadCachedData;

  // Load fresh data directly (bypass cache to avoid duplicate requests)
  // We already have cached data rendered, so fetch fresh without triggering background revalidation
  const loadFreshData = Effect.gen(function* () {
    if (!navigator.onLine) {
      // Offline: use local data
      const localTimer = yield* getTimerFromLocal();
      const localEntries = yield* getLocalEntries();
      return { projects: [], timer: localTimer, entries: localEntries };
    }

    // Fetch fresh data directly (bypass cache revalidation to avoid duplicate requests)
    const fetchProjects = Effect.gen(function* () {
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
      yield* setCached(CacheKeys.projects, projects);
      return projects;
    });

    const fetchTimer = Effect.gen(function* () {
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
      if (timer) {
        yield* setCached(CacheKeys.timer, timer);
      }
      return timer;
    });

    const fetchEntries = Effect.gen(function* () {
      const localEntries = yield* getLocalEntries();
      const response = yield* Effect.tryPromise({
        try: () => fetch("/api/entries", { credentials: "include" }),
        catch: (error) => new Error(`Failed to fetch entries: ${error}`),
      });
      if (!response.ok) {
        handleAuthError(response);
        return localEntries;
      }
      const entries = yield* Effect.tryPromise({
        try: () => response.json() as Promise<Entry[]>,
        catch: (error) => new Error(`Failed to parse entries JSON: ${error}`),
      });
      const serverIds = new Set(entries.map((e) => e.id));
      const uniqueLocalEntries = localEntries.filter(
        (e) => !serverIds.has(e.id)
      );
      const merged = [...entries, ...uniqueLocalEntries].sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      yield* setCached(CacheKeys.entries, entries);
      return merged;
    });

    const [freshProjects, freshTimer, freshEntries] = yield* Effect.all(
      [fetchProjects, fetchTimer, fetchEntries],
      { concurrency: "unbounded" }
    );

    // Update UI with fresh data (may be same as cached, but ensures consistency)
    yield* Ref.set(refs.projectsRef, freshProjects);
    yield* populateProjectCombobox(freshProjects);

    // Update timer
    if (freshTimer) {
      yield* Ref.set(refs.timerRef, freshTimer);
      yield* Ref.set(refs.selectedProjectIdRef, freshTimer.projectId);
      yield* populateProjectCombobox(freshProjects, freshTimer.projectId);
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
    } else {
      yield* showPlayButton();
    }

    // Update entries
    yield* renderEntries(freshEntries, freshProjects);
  });

  // Start loading fresh data (will update UI when ready)
  // This runs in parallel with the cached data already rendered
  yield* loadFreshData;

  // Set up online/offline listeners
  setupOnlineStatusListeners(refs.timerRef, refs.intervalRef);

  // Create WebSocket connection (will trigger refresh on updates via messages)
  // Note: We don't fetch on WebSocket open since we already fetched on initial load
  const ws = createWebSocket(refs, null);
  // Store WebSocket instance for cleanup
  setWebSocketInstance(ws);

  // Setup event handlers
  setupTimerButtonHandler(playPauseBtn, refs);
  setupEntryClickHandlers(entriesList, refs.projectsRef);
  setupEntryFormHandler(entriesList, refs.projectsRef);

  // Add project button handler
  addProjectBtn.addEventListener("click", () => {
    projectInputContainer.classList.remove("hidden");
    projectNameInput.focus();
  });

  // Setup project creation handlers
  setupProjectCreationHandlers(
    refs,
    {
      container: projectInputContainer,
      input: projectNameInput,
      submitBtn: projectSubmitBtn,
    },
    createProject as (
      name: string
    ) => Effect.Effect<Project, Error | { error: string }>
  );
});

// Setup cleanup listeners
setupCleanupListeners();

// Initialize routing (handles initial route and sets up navigation)
initializeRouting(initializeApp);
