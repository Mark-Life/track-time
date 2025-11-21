import "~/global.css";
import { Effect, Ref } from "effect";
import { initializeDrawer } from "~/components/ui/drawer.ts";
import { getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Project } from "~/lib/types.ts";
import { createProject, getEntries, getTimer } from "./api.ts";
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
  loadProjects,
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
  // Initialize drawer
  yield* initializeDrawer();

  // Load user email first
  yield* loadUserEmail;

  // Setup logout button
  setupLogout();

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

  // Load initial data
  const loadInitialData = Effect.gen(function* () {
    // Show loading state for entries
    yield* showEntriesLoading();

    // Load projects
    const projects = yield* loadProjects;
    yield* Ref.set(refs.projectsRef, projects);

    // Check localStorage first for offline timer
    const localTimer = yield* getTimerFromLocal();
    if (localTimer && !navigator.onLine) {
      yield* Ref.set(refs.timerRef, localTimer);
      yield* Ref.set(refs.selectedProjectIdRef, localTimer.projectId);
      yield* populateProjectCombobox(projects, localTimer.projectId);
      yield* startTimerUI(refs.timerRef, refs.intervalRef);
    } else {
      const timer = yield* getTimer;
      if (timer) {
        yield* Ref.set(refs.timerRef, timer);
        yield* Ref.set(refs.selectedProjectIdRef, timer.projectId);
        yield* populateProjectCombobox(projects, timer.projectId);
        yield* startTimerUI(refs.timerRef, refs.intervalRef);
      } else {
        // No timer active, show play button
        yield* showPlayButton();
      }
    }

    const entries = yield* getEntries;
    const currentProjects = yield* Ref.get(refs.projectsRef);
    yield* renderEntries(entries, currentProjects);
  });

  // Set up online/offline listeners
  setupOnlineStatusListeners(refs.timerRef, refs.intervalRef);

  // Create WebSocket connection
  const ws = createWebSocket(refs, loadInitialData);
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
    projectInputContainer,
    projectNameInput,
    projectSubmitBtn,
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
