import "~/global.css";
import { Effect, Ref } from "effect";
import { initializeDrawer } from "~/components/ui/drawer.ts";
import { CacheKeys, getCached } from "~/lib/cache.ts";
import { getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Entry, Project, Timer } from "~/lib/types.ts";
import { createProject, getEntries, getProjects, getTimer } from "./api.ts";
import {
  type AppRefs,
  appInitialized,
  appRefs,
  createAppRefs,
  setupCleanupListeners,
  setWebSocketInstance,
} from "./app-state.ts";
import { renderEntries, showEntriesLoading, showPlayButton } from "./dom.ts";
import {
  addProjectBtn,
  entriesList,
  playPauseBtn,
  projectInputContainer,
  projectNameInput,
  projectSubmitBtn,
} from "./dom-elements.ts";
import {
  setupEntryClickHandlers,
  setupEntryFormHandler,
} from "./entry-handlers.ts";
import { setupOnlineStatusListeners } from "./online-status.ts";
import {
  initializeProjectCombobox,
  populateProjectCombobox,
  setupProjectCreationHandlers,
} from "./project-management.ts";
import { initializeRouting, normalizeRoute } from "./routing.ts";
import { setupTimerButtonHandler } from "./timer-handlers.ts";
import { startTimerUI } from "./timer-ui.ts";
import { loadUserEmail, setupLogout } from "./user-management.ts";
import { createWebSocket } from "./websocket-handlers.ts";

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

  // Load fresh data in parallel (stale-while-revalidate)
  // The API functions will return cached data immediately and fetch fresh in background
  // When fresh data arrives, it updates the cache, and we update the UI
  const loadFreshData = Effect.gen(function* () {
    // Fetch projects, timer, and entries in parallel
    // These will return cached data immediately if available, then fetch fresh
    const timerEffect = navigator.onLine
      ? getTimer
      : Effect.gen(function* () {
          return yield* getTimerFromLocal();
        });

    const [projects, timer, entries] = yield* Effect.all(
      [getProjects, timerEffect, getEntries],
      { concurrency: "unbounded" }
    );

    // Update UI with fresh data (may be same as cached, but ensures consistency)
    yield* Ref.set(refs.projectsRef, projects);
    yield* populateProjectCombobox(projects);

    // Update timer
    if (timer) {
      yield* Ref.set(refs.timerRef, timer);
      yield* Ref.set(refs.selectedProjectIdRef, timer.projectId);
      yield* populateProjectCombobox(projects, timer.projectId);
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
    } else {
      yield* showPlayButton();
    }

    // Update entries
    yield* renderEntries(entries, projects);
  });

  // Start loading fresh data (will update UI when ready)
  // This runs in parallel with the cached data already rendered
  yield* loadFreshData;

  // Set up online/offline listeners
  setupOnlineStatusListeners(refs.timerRef, refs.intervalRef);

  // Create WebSocket connection (will trigger refresh on updates)
  const refreshData = Effect.gen(function* () {
    const timerEffect = navigator.onLine
      ? getTimer
      : Effect.gen(function* () {
          return yield* getTimerFromLocal();
        });

    const [projects, timer, entries] = yield* Effect.all(
      [getProjects, timerEffect, getEntries],
      { concurrency: "unbounded" }
    );

    yield* Ref.set(refs.projectsRef, projects);
    yield* populateProjectCombobox(projects);

    if (timer) {
      yield* Ref.set(refs.timerRef, timer);
      yield* Ref.set(refs.selectedProjectIdRef, timer.projectId);
      yield* populateProjectCombobox(projects, timer.projectId);
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
    } else {
      yield* showPlayButton();
    }

    yield* renderEntries(entries, projects);
  });

  const ws = createWebSocket(refs, refreshData);
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

// Initialize routing
initializeRouting(initializeApp);

// Run the app based on current route
const currentRouteOnLoad = normalizeRoute(window.location.pathname);
if (currentRouteOnLoad === "/app/projects") {
  // Projects page initialization is handled by routing
} else {
  Effect.runPromise(
    Effect.catchAll(initializeApp, (error) =>
      Effect.logError(`Failed to initialize app: ${error}`)
    )
  );
}
