import "~/global.css";
import { Effect, Ref } from "effect";
import {
  type ComboboxOption,
  createCombobox,
  setComboboxValue,
  updateComboboxOptions,
} from "~/components/ui/combobox.ts";
import { getTimerFromLocal } from "~/lib/local-storage.ts";
import type { Project, Timer, WebSocketMessage } from "~/lib/types.ts";
import {
  createProject,
  deleteEntry,
  getCurrentUser,
  getEntries,
  getProjects,
  getTimer,
  logout,
  startTimer,
  stopTimer,
  updateEntry,
} from "./api.ts";
import {
  addEntryToList,
  renderEntries,
  renderEntryEditForm,
  renderEntryView,
  showFormError,
  showPlayButton,
} from "./dom.ts";
import {
  addProjectBtn,
  entriesList,
  playPauseBtn,
  projectInputContainer,
  projectNameInput,
} from "./dom-elements.ts";
import {
  hideOfflineIndicator,
  showOfflineIndicator,
} from "./offline-indicator.ts";
import { initializeProjectsPage } from "./projects.ts";
import { syncWithServer } from "./sync.ts";
import { startTimerUI, stopTimerUI } from "./timer-ui.ts";

// Accept HMR updates
if (import.meta.hot) {
  import.meta.hot.accept();
}

// Client-side routing
const timerPage = document.getElementById("timer-page") as HTMLDivElement;
const projectsPage = document.getElementById("projects-page") as HTMLDivElement;
const navLinks = Array.from(
  document.querySelectorAll(".nav-link")
) as HTMLAnchorElement[];

// Normalize route (remove trailing slash, ensure it starts with /app)
const normalizeRoute = (route: string): string => {
  const normalized =
    route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
  // If route doesn't start with /app, default to /app
  if (!normalized.startsWith("/app")) {
    return "/app";
  }
  return normalized;
};

const showPage = (route: string) => {
  const normalizedRoute = normalizeRoute(route);

  if (normalizedRoute === "/app/projects") {
    timerPage.classList.add("hidden");
    projectsPage.classList.remove("hidden");
    // Update URL without reload
    window.history.pushState({ route: normalizedRoute }, "", "/app/projects");
  } else {
    timerPage.classList.remove("hidden");
    projectsPage.classList.add("hidden");
    // Update URL without reload
    window.history.pushState({ route: normalizedRoute }, "", "/app");
  }

  // Update active nav link
  for (const link of navLinks) {
    const linkRoute = link.getAttribute("data-route");
    if (linkRoute === normalizedRoute) {
      link.classList.add("font-bold", "text-primary");
    } else {
      link.classList.remove("font-bold", "text-primary");
    }
  }
};

// Handle initial route
const currentRoute = normalizeRoute(window.location.pathname);
showPage(currentRoute);

// Handle navigation clicks
for (const link of navLinks) {
  link.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    const route = link.getAttribute("data-route");
    if (route) {
      showPage(route);
      if (route === "/app/projects") {
        Effect.runPromise(
          Effect.catchAll(initializeProjectsPage, (error) =>
            Effect.logError(`Failed to initialize projects page: ${error}`)
          )
        );
      } else if (route === "/app") {
        // Initialize app or load entries if already initialized
        Effect.runPromise(
          Effect.catchAll(initializeApp, (error) =>
            Effect.logError(`Failed to initialize app: ${error}`)
          )
        );
      }
    }
  });
}

// Handle browser back/forward
window.addEventListener("popstate", () => {
  const route = normalizeRoute(window.location.pathname);
  showPage(route);
  if (route === "/app/projects") {
    Effect.runPromise(
      Effect.catchAll(initializeProjectsPage, (error) =>
        Effect.logError(`Failed to initialize projects page: ${error}`)
      )
    );
  } else if (route === "/app") {
    // Initialize app or load entries if already initialized
    Effect.runPromise(
      Effect.catchAll(initializeApp, (error) =>
        Effect.logError(`Failed to initialize app: ${error}`)
      )
    );
  }
});

// Store references for cleanup
let wsInstance: WebSocket | null = null;
let intervalRefInstance: Ref.Ref<number | null> | null = null;
let appInitialized = false;
let appRefs: {
  timerRef: Ref.Ref<Timer | null>;
  intervalRef: Ref.Ref<number | null>;
  projectsRef: Ref.Ref<Project[]>;
  selectedProjectIdRef: Ref.Ref<string | undefined>;
  pendingProjectIdRef: Ref.Ref<string | null>;
} | null = null;

// Cleanup function
const cleanup = Effect.gen(function* () {
  // Close WebSocket if open
  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
    wsInstance.close();
    wsInstance = null;
  }

  // Clear interval if exists
  if (intervalRefInstance) {
    const intervalId = yield* Ref.get(intervalRefInstance);
    if (intervalId !== null) {
      clearInterval(intervalId);
      yield* Ref.set(intervalRefInstance, null);
    }
  }
});

// Set up cleanup on page unload
window.addEventListener("beforeunload", () => {
  Effect.runPromise(cleanup);
});

window.addEventListener("unload", () => {
  Effect.runPromise(cleanup);
});

// Project management functions
const populateProjectCombobox = (projects: Project[], selectedId?: string) =>
  Effect.gen(function* () {
    const options: ComboboxOption<string>[] = projects.map((project) => ({
      value: project.id,
      label: project.name,
    }));
    yield* updateComboboxOptions("project-combobox", options);
    yield* setComboboxValue("project-combobox", selectedId);
  });

const loadProjects = Effect.gen(function* () {
  const projects = yield* getProjects;
  yield* populateProjectCombobox(projects);
  return projects;
});

// Load entries function that can be called independently
const loadEntriesForTimerPage = Effect.gen(function* () {
  if (!appRefs) {
    return;
  }
  const entries = yield* getEntries;
  const currentProjects = yield* Ref.get(appRefs.projectsRef);
  yield* renderEntries(entries, currentProjects);
});

// Load and display user email
const loadUserEmail = Effect.gen(function* () {
  const userEmailElement = document.getElementById("user-email");
  if (!userEmailElement) {
    return;
  }

  const user = yield* Effect.catchAll(getCurrentUser, (error) =>
    Effect.gen(function* () {
      yield* Effect.log(`Failed to load user email: ${error}`);
      return null;
    })
  );

  if (user) {
    userEmailElement.textContent = user.email;
  }
});

// Setup logout button (shared between timer and projects pages)
const setupLogout = () => {
  const logoutBtn = document.getElementById("logout-btn");
  if (!logoutBtn) {
    return;
  }

  // Remove existing listeners by cloning and replacing
  const newLogoutBtn = logoutBtn.cloneNode(true) as HTMLButtonElement;
  logoutBtn.parentNode?.replaceChild(newLogoutBtn, logoutBtn);

  newLogoutBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(logout, (error) =>
        Effect.gen(function* () {
          yield* Effect.logError(`Failed to logout: ${error}`);
          // Still redirect even if logout fails
          window.location.href = "/login";
        })
      )
    );
  });
};

// Main app initialization
const initializeApp = Effect.gen(function* () {
  // Load user email first
  yield* loadUserEmail;

  // Setup logout button
  setupLogout();

  // Use existing refs if already initialized, otherwise create new ones
  let timerRef: Ref.Ref<Timer | null>;
  let intervalRef: Ref.Ref<number | null>;
  let projectsRef: Ref.Ref<Project[]>;
  let selectedProjectIdRef: Ref.Ref<string | undefined>;
  let pendingProjectIdRef: Ref.Ref<string | null>;

  if (appInitialized && appRefs) {
    // Already initialized, use existing refs and just load entries
    timerRef = appRefs.timerRef;
    intervalRef = appRefs.intervalRef;
    projectsRef = appRefs.projectsRef;
    selectedProjectIdRef = appRefs.selectedProjectIdRef;
    pendingProjectIdRef = appRefs.pendingProjectIdRef;
    yield* loadEntriesForTimerPage;
    return;
  }

  // Create new refs for first-time initialization
  timerRef = yield* Ref.make<Timer | null>(null);
  intervalRef = yield* Ref.make<number | null>(null);
  projectsRef = yield* Ref.make<Project[]>([]);
  selectedProjectIdRef = yield* Ref.make<string | undefined>(undefined);
  pendingProjectIdRef = yield* Ref.make<string | null>(null);

  // Store references
  appRefs = {
    timerRef,
    intervalRef,
    projectsRef,
    selectedProjectIdRef,
    pendingProjectIdRef,
  };
  intervalRefInstance = intervalRef;
  appInitialized = true;

  // Initialize combobox
  yield* createCombobox({
    containerId: "project-combobox",
    inputId: "project-combobox-input",
    listId: "project-combobox-list",
    placeholder: "No project",
    emptyText: "No projects found",
    onSelect: (value) =>
      Effect.gen(function* () {
        yield* Ref.set(selectedProjectIdRef, value);
      }),
  });

  // Load initial data
  const loadInitialData = Effect.gen(function* () {
    // Load projects
    const projects = yield* loadProjects;
    yield* Ref.set(projectsRef, projects);

    // Check localStorage first for offline timer
    const localTimer = yield* getTimerFromLocal();
    if (localTimer && !navigator.onLine) {
      yield* Ref.set(timerRef, localTimer);
      yield* Ref.set(selectedProjectIdRef, localTimer.projectId);
      yield* populateProjectCombobox(projects, localTimer.projectId);
      yield* startTimerUI(timerRef, intervalRef);
    } else {
      const timer = yield* getTimer;
      if (timer) {
        yield* Ref.set(timerRef, timer);
        yield* Ref.set(selectedProjectIdRef, timer.projectId);
        yield* populateProjectCombobox(projects, timer.projectId);
        yield* startTimerUI(timerRef, intervalRef);
      } else {
        // No timer active, show play button
        yield* showPlayButton();
      }
    }

    const entries = yield* getEntries;
    const currentProjects = yield* Ref.get(projectsRef);
    yield* renderEntries(entries, currentProjects);
  });

  // Set up online/offline listeners
  const updateOnlineStatus = () =>
    Effect.gen(function* () {
      if (navigator.onLine) {
        yield* hideOfflineIndicator;
        // Attempt sync when coming back online
        yield* syncWithServer(timerRef, intervalRef);
      } else {
        yield* showOfflineIndicator;
      }
    });

  // Initial online status
  Effect.runPromise(
    Effect.catchAll(updateOnlineStatus(), (error) =>
      Effect.logError(`Failed to update online status: ${error}`)
    )
  );

  // Listen for online/offline events
  window.addEventListener("online", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle online event: ${error}`)
      )
    );
  });

  window.addEventListener("offline", () => {
    Effect.runPromise(
      Effect.catchAll(updateOnlineStatus(), (error) =>
        Effect.logError(`Failed to handle offline event: ${error}`)
      )
    );
  });

  // WebSocket connection
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  wsInstance = ws;

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected"));
    Effect.runPromise(
      Effect.catchAll(loadInitialData, (error) =>
        Effect.logError(`Failed to load initial data: ${error}`)
      )
    );
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO fix me later
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
      const projectId = message.data.projectId;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* Ref.set(timerRef, {
              startedAt,
              ...(projectId ? { projectId } : {}),
            });
            yield* Ref.set(selectedProjectIdRef, projectId);
            const currentProjects = yield* Ref.get(projectsRef);
            yield* populateProjectCombobox(currentProjects, projectId);
            yield* startTimerUI(timerRef, intervalRef);
          }),
          (error) => Effect.logError(`Failed to handle timer:started: ${error}`)
        )
      );
    } else if (message.type === "project:created") {
      const project = message.data.project;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const currentProjects = yield* Ref.get(projectsRef);
            const updatedProjects = [...currentProjects, project].sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            yield* Ref.set(projectsRef, updatedProjects);
            const pendingId = yield* Ref.get(pendingProjectIdRef);
            // If this is the project we just created, select it
            if (pendingId === project.id) {
              yield* Ref.set(pendingProjectIdRef, null);
              yield* Ref.set(selectedProjectIdRef, project.id);
              yield* populateProjectCombobox(updatedProjects, project.id);
            } else {
              const selectedId = yield* Ref.get(selectedProjectIdRef);
              yield* populateProjectCombobox(updatedProjects, selectedId);
            }
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
            const currentProjects = yield* Ref.get(projectsRef);
            const updatedProjects = currentProjects
              .map((p) => (p.id === project.id ? project : p))
              .sort((a, b) => a.name.localeCompare(b.name));
            yield* Ref.set(projectsRef, updatedProjects);
            const selectedId = yield* Ref.get(selectedProjectIdRef);
            yield* populateProjectCombobox(updatedProjects, selectedId);
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
            const currentProjects = yield* Ref.get(projectsRef);
            const updatedProjects = currentProjects.filter((p) => p.id !== id);
            yield* Ref.set(projectsRef, updatedProjects);
            const selectedId = yield* Ref.get(selectedProjectIdRef);
            if (selectedId === id) {
              yield* Ref.set(selectedProjectIdRef, undefined);
            }
            yield* populateProjectCombobox(updatedProjects, selectedId);
            // Reload entries to reflect project deletion
            const entries = yield* getEntries;
            yield* renderEntries(entries, updatedProjects);
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
            yield* stopTimerUI(intervalRef);
            yield* Ref.set(timerRef, null);
            const projects = yield* Ref.get(projectsRef);
            yield* addEntryToList(entry, projects);
          }),
          (error) => Effect.logError(`Failed to handle timer:stopped: ${error}`)
        )
      );
    } else if (message.type === "entry:deleted") {
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* getEntries;
            const projects = yield* Ref.get(projectsRef);
            yield* renderEntries(entries, projects);
          }),
          (error) => Effect.logError(`Failed to handle entry:deleted: ${error}`)
        )
      );
    } else if (message.type === "entry:updated") {
      const entry = message.data.entry;
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const projects = yield* Ref.get(projectsRef);
            yield* renderEntryView(entry, projects);
          }),
          (error) => Effect.logError(`Failed to handle entry:updated: ${error}`)
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

  // Button handler - toggle play/pause based on timer state
  playPauseBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const timer = yield* Ref.get(timerRef);
          if (timer) {
            // Timer is running, stop it
            const entry = yield* stopTimer;
            yield* stopTimerUI(intervalRef);
            yield* Ref.set(timerRef, null);
            // Reload and render entries to show the new entry (works for both online and offline)
            if (entry) {
              const entries = yield* getEntries;
              const projects = yield* Ref.get(projectsRef);
              yield* renderEntries(entries, projects);
            }
          } else {
            // Timer is stopped, start it
            const selectedProjectId = yield* Ref.get(selectedProjectIdRef);
            const newTimer = yield* startTimer(undefined, selectedProjectId);
            yield* Ref.set(timerRef, newTimer);
            yield* startTimerUI(timerRef, intervalRef);
          }
        }),
        (error) => Effect.logError(`Failed to toggle timer: ${error}`)
        // Could show user-friendly error message here
      )
    );
  });

  // Entry handlers (event delegation)
  entriesList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    // Edit button handler
    const editBtn = target.closest(".edit-entry-btn") as HTMLButtonElement;
    if (editBtn) {
      const entryId = editBtn.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* getEntries;
            const entry = entries.find((e) => e.id === entryId);
            const projects = yield* Ref.get(projectsRef);
            if (entry) {
              yield* renderEntryEditForm(entry, projects);
            }
          }),
          (error) => Effect.logError(`Failed to show edit form: ${error}`)
        )
      );
      return;
    }

    // Cancel button handler
    const cancelBtn = target.closest(".cancel-edit-btn") as HTMLButtonElement;
    if (cancelBtn) {
      const entryId = cancelBtn.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* getEntries;
            const entry = entries.find((e) => e.id === entryId);
            const currentProjects = yield* Ref.get(projectsRef);
            if (entry) {
              yield* renderEntryView(entry, currentProjects);
            }
          }),
          (error) => Effect.logError(`Failed to cancel edit: ${error}`)
        )
      );
      return;
    }

    // Delete button handler
    const deleteBtn = target.closest(".delete-entry-btn") as HTMLButtonElement;
    if (deleteBtn) {
      const entryId = deleteBtn.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            yield* deleteEntry(entryId);
            const entries = yield* getEntries;
            const currentProjects = yield* Ref.get(projectsRef);
            yield* renderEntries(entries, currentProjects);
          }),
          (error) => Effect.logError(`Failed to delete entry: ${error}`)
        )
      );
      return;
    }
  });

  // Form validation helper
  const validateEntryForm = (
    form: HTMLFormElement
  ):
    | { valid: false; error: string }
    | {
        valid: true;
        startedAt: string;
        endedAt: string;
        projectId: string | undefined;
      } => {
    const formData = new FormData(form);
    const startedAtInput = formData.get("startedAt") as string;
    const endedAtInput = formData.get("endedAt") as string;
    const projectIdInput = formData.get("projectId") as string;
    const projectId =
      projectIdInput && projectIdInput.trim() !== ""
        ? projectIdInput
        : undefined;

    if (!startedAtInput) {
      return { valid: false, error: "Start time is required" };
    }
    if (!endedAtInput) {
      return { valid: false, error: "End time is required" };
    }

    const startedAtDate = new Date(startedAtInput);
    const endedAtDate = new Date(endedAtInput);

    if (Number.isNaN(startedAtDate.getTime())) {
      return { valid: false, error: "Invalid start time format" };
    }

    if (Number.isNaN(endedAtDate.getTime())) {
      return { valid: false, error: "Invalid end time format" };
    }

    if (endedAtDate.getTime() <= startedAtDate.getTime()) {
      return { valid: false, error: "End time must be after start time" };
    }

    return {
      valid: true,
      startedAt: startedAtDate.toISOString(),
      endedAt: endedAtDate.toISOString(),
      projectId,
    };
  };

  // Form submission handler (event delegation)
  entriesList.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.classList.contains("edit-entry-form")) {
      return;
    }

    const entryId = form.getAttribute("data-entry-id");
    if (!entryId) {
      return;
    }

    const validation = validateEntryForm(form);
    if (!validation.valid) {
      Effect.runPromise(showFormError(form, validation.error));
      return;
    }

    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const updatedEntry = yield* updateEntry(
            entryId,
            validation.startedAt,
            validation.endedAt,
            validation.projectId
          );
          const currentProjects = yield* Ref.get(projectsRef);
          yield* renderEntryView(updatedEntry, currentProjects);
        }),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logError(`Failed to update entry: ${error}`);
            const errorMessage =
              error instanceof Error ? error.message : "Failed to update entry";
            yield* showFormError(form, errorMessage);
            const entries = yield* getEntries;
            const currentProjects = yield* Ref.get(projectsRef);
            yield* renderEntries(entries, currentProjects);
          })
      )
    );
  });

  // Add project button handler
  addProjectBtn.addEventListener("click", () => {
    projectInputContainer.classList.remove("hidden");
    projectNameInput.focus();
  });

  // Project input handlers
  const handleProjectCreate = () =>
    Effect.gen(function* () {
      const name = projectNameInput.value.trim();
      if (!name) {
        projectInputContainer.classList.add("hidden");
        projectNameInput.value = "";
        return;
      }

      try {
        const project = yield* createProject(name);
        // Store the project ID so WebSocket handler can select it
        yield* Ref.set(pendingProjectIdRef, project.id);
        projectInputContainer.classList.add("hidden");
        projectNameInput.value = "";
        // Project will be added via WebSocket message
      } catch (error) {
        yield* Ref.set(pendingProjectIdRef, null);
        yield* Effect.logError(`Failed to create project: ${error}`);
        console.error(
          error instanceof Error ? error.message : "Failed to create project"
        );
      }
    });

  projectNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      Effect.runPromise(
        Effect.catchAll(handleProjectCreate(), (error) =>
          Effect.logError(`Failed to create project: ${error}`)
        )
      );
    } else if (e.key === "Escape") {
      projectInputContainer.classList.add("hidden");
      projectNameInput.value = "";
    }
  });

  projectNameInput.addEventListener("blur", () => {
    Effect.runPromise(
      Effect.catchAll(handleProjectCreate(), (error) =>
        Effect.logError(`Failed to create project: ${error}`)
      )
    );
  });
});

// Run the app based on current route
const currentRouteOnLoad = normalizeRoute(window.location.pathname);
if (currentRouteOnLoad === "/app/projects") {
  Effect.runPromise(
    Effect.catchAll(initializeProjectsPage, (error) =>
      Effect.logError(`Failed to initialize projects page: ${error}`)
    )
  );
} else {
  Effect.runPromise(
    Effect.catchAll(initializeApp, (error) =>
      Effect.logError(`Failed to initialize app: ${error}`)
    )
  );
}
