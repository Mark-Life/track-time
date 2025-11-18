import { Effect, Ref } from "effect";
import { editIcon, trashIcon } from "~/assets/icons";
import type { Project, WebSocketMessage } from "~/lib/types.ts";
import { deleteProject, getProjects, updateProject } from "./api.ts";

const projectsContainer = document.getElementById(
  "projects-container"
) as HTMLDivElement;
const deleteModal = document.getElementById("delete-modal") as HTMLDivElement;
const deleteModalProjectName = document.getElementById(
  "delete-modal-project-name"
) as HTMLDivElement;
const deleteEntriesBtn = document.getElementById(
  "delete-entries-btn"
) as HTMLButtonElement;
const keepEntriesBtn = document.getElementById(
  "keep-entries-btn"
) as HTMLButtonElement;
const cancelDeleteBtn = document.getElementById(
  "cancel-delete-btn"
) as HTMLButtonElement;

let deleteProjectIdRef: Ref.Ref<string | null> | null = null;

const projectHTML = (project: Project, isEditing = false): string => {
  if (isEditing) {
    return `
      <div class="p-4 border border-border rounded-lg" data-project-id="${project.id}">
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            class="project-name-input flex-1 px-3 py-2 border border-border rounded bg-background text-foreground"
            value="${project.name}"
            maxlength="50"
            data-project-id="${project.id}"
          />
          <div class="flex gap-2">
            <button
              class="cancel-edit-project-btn flex-1 sm:flex-none px-4 py-2 border border-border rounded hover:bg-muted cursor-pointer"
              data-project-id="${project.id}"
            >
              Cancel
            </button>
            <button
              class="save-project-btn flex-1 sm:flex-none px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/80 cursor-pointer"
              data-project-id="${project.id}"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="group p-4 border border-border rounded-lg relative" data-project-id="${project.id}">
      <div class="flex justify-between items-center">
        <div class="project-name-display cursor-pointer flex-1" data-project-id="${project.id}">
          <span class="text-lg font-medium">${project.name}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="edit-project-btn text-foreground bg-primary p-2 rounded-full hover:bg-primary/80 cursor-pointer flex items-center justify-center"
            data-project-id="${project.id}"
            aria-label="Edit project"
          >
            ${editIcon(16)}
          </button>
          <button
            class="delete-project-btn text-white bg-destructive p-2 rounded-full hover:bg-destructive/80 cursor-pointer flex items-center justify-center"
            data-project-id="${project.id}"
            aria-label="Delete project"
          >
            ${trashIcon(16)}
          </button>
        </div>
      </div>
    </div>
  `;
};

const renderProjects = (projects: Project[]) =>
  Effect.sync(() => {
    if (projects.length === 0) {
      projectsContainer.innerHTML =
        '<p class="text-gray-500" data-no-projects>No projects yet. Create one from the timer page!</p>';
      return;
    }

    projectsContainer.innerHTML = projects
      .map((project) => projectHTML(project))
      .join("");
  });

const showDeleteModal = (project: Project) =>
  Effect.sync(() => {
    if (!deleteProjectIdRef) {
      return;
    }
    Effect.runSync(Ref.set(deleteProjectIdRef, project.id));
    deleteModalProjectName.textContent = project.name;
    deleteModal.classList.remove("hidden");
  });

const hideDeleteModal = () =>
  Effect.sync(() => {
    if (!deleteProjectIdRef) {
      return;
    }
    Effect.runSync(Ref.set(deleteProjectIdRef, null));
    deleteModal.classList.add("hidden");
  });

const showEditForm = (projectId: string) =>
  Effect.gen(function* () {
    const projects = yield* getProjects;
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }

    const projectElement = projectsContainer.querySelector(
      `[data-project-id="${projectId}"]`
    ) as HTMLElement;
    if (!projectElement) {
      return;
    }

    projectElement.outerHTML = projectHTML(project, true);
    const input = projectsContainer.querySelector(
      `.project-name-input[data-project-id="${projectId}"]`
    ) as HTMLInputElement;
    if (input) {
      input.focus();
      input.select();
    }
  });

const cancelEdit = (projectId: string) =>
  Effect.gen(function* () {
    const projects = yield* getProjects;
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }

    const projectElement = projectsContainer.querySelector(
      `[data-project-id="${projectId}"]`
    ) as HTMLElement;
    if (projectElement) {
      projectElement.outerHTML = projectHTML(project, false);
    }
  });

const saveProject = (projectId: string, newName: string) =>
  Effect.gen(function* () {
    if (!newName) {
      console.error("Project name cannot be empty");
      return;
    }

    yield* updateProject(projectId, newName);
    const projects = yield* getProjects;
    yield* renderProjects(projects);
  });

const handleSaveError = (error: unknown) =>
  Effect.gen(function* () {
    yield* Effect.logError(`Failed to update project: ${error}`);
    console.error(
      error instanceof Error ? error.message : "Failed to update project"
    );
    const projects = yield* getProjects;
    yield* renderProjects(projects);
  });

const handleDeleteError = (error: unknown) =>
  Effect.gen(function* () {
    yield* Effect.logError(`Failed to delete project: ${error}`);
    console.error(
      error instanceof Error ? error.message : "Failed to delete project"
    );
    yield* hideDeleteModal();
  });

const handleEditClick = (projectId: string) => {
  Effect.runPromise(
    Effect.catchAll(showEditForm(projectId), (error) =>
      Effect.logError(`Failed to show edit form: ${error}`)
    )
  );
};

const handleCancelClick = (projectId: string) => {
  Effect.runPromise(
    Effect.catchAll(cancelEdit(projectId), (error) =>
      Effect.logError(`Failed to cancel edit: ${error}`)
    )
  );
};

const handleSaveClick = (projectId: string) => {
  const projectElement = projectsContainer.querySelector(
    `[data-project-id="${projectId}"]`
  ) as HTMLElement;
  if (!projectElement) {
    return;
  }

  const input = projectElement.querySelector(
    ".project-name-input"
  ) as HTMLInputElement;
  if (!input) {
    return;
  }

  const newName = input.value.trim();
  Effect.runPromise(
    Effect.catchAll(saveProject(projectId, newName), handleSaveError)
  );
};

const handleDeleteClick = (projectId: string) => {
  Effect.runPromise(
    Effect.catchAll(
      Effect.gen(function* () {
        const projects = yield* getProjects;
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          yield* showDeleteModal(project);
        }
      }),
      (error) => Effect.logError(`Failed to show delete modal: ${error}`)
    )
  );
};

const handleProjectContainerClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;

  // Edit button handler
  const editBtn = target.closest(".edit-project-btn") as HTMLButtonElement;
  if (editBtn) {
    const projectId = editBtn.getAttribute("data-project-id");
    if (projectId) {
      handleEditClick(projectId);
    }
    return;
  }

  // Project name click handler (edit)
  const nameDisplay = target.closest(".project-name-display") as HTMLElement;
  if (nameDisplay) {
    const projectId = nameDisplay.getAttribute("data-project-id");
    if (projectId) {
      handleEditClick(projectId);
    }
    return;
  }

  // Cancel edit button handler
  const cancelBtn = target.closest(
    ".cancel-edit-project-btn"
  ) as HTMLButtonElement;
  if (cancelBtn) {
    const projectId = cancelBtn.getAttribute("data-project-id");
    if (projectId) {
      handleCancelClick(projectId);
    }
    return;
  }

  // Save button handler
  const saveBtn = target.closest(".save-project-btn") as HTMLButtonElement;
  if (saveBtn) {
    const projectId = saveBtn.getAttribute("data-project-id");
    if (projectId) {
      handleSaveClick(projectId);
    }
    return;
  }

  // Delete button handler
  const deleteBtn = target.closest(".delete-project-btn") as HTMLButtonElement;
  if (deleteBtn) {
    const projectId = deleteBtn.getAttribute("data-project-id");
    if (projectId) {
      handleDeleteClick(projectId);
    }
  }
};

// Setup logout button (shared between timer and projects pages)
const setupLogoutButton = () => {
  const logoutBtn = document.getElementById("logout-btn");
  if (!logoutBtn) {
    return;
  }

  // Remove existing listeners by cloning and replacing
  const newLogoutBtn = logoutBtn.cloneNode(true) as HTMLButtonElement;
  logoutBtn.parentNode?.replaceChild(newLogoutBtn, logoutBtn);

  newLogoutBtn.addEventListener("click", () => {
    import("./api.ts").then(({ logout }) => {
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
  });
};

export const initializeProjectsPage = Effect.gen(function* () {
  deleteProjectIdRef = yield* Ref.make<string | null>(null);

  // Setup logout button
  setupLogoutButton();

  // Load projects
  const loadProjects = Effect.gen(function* () {
    const projects = yield* getProjects;
    yield* renderProjects(projects);
  });

  yield* loadProjects;

  // WebSocket connection for real-time updates
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    Effect.runPromise(Effect.log("WebSocket connected (projects page)"));
  };

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

    // Handle project-related messages
    if (
      message.type === "project:created" ||
      message.type === "project:updated" ||
      message.type === "project:deleted"
    ) {
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const projects = yield* getProjects;
            yield* renderProjects(projects);
          }),
          (error) => Effect.logError(`Failed to update projects list: ${error}`)
        )
      );
    }
  };

  ws.onerror = (error) => {
    Effect.runPromise(Effect.logError(`WebSocket error: ${error}`));
  };

  ws.onclose = () => {
    Effect.runPromise(Effect.log("WebSocket disconnected (projects page)"));
  };

  // Event delegation for project actions
  projectsContainer.addEventListener("click", handleProjectContainerClick);

  // Handle input blur/enter for inline editing
  projectsContainer.addEventListener(
    "blur",
    (event) => {
      const target = event.target as HTMLInputElement;
      if (target.classList.contains("project-name-input")) {
        const projectId = target.getAttribute("data-project-id");
        if (!projectId) {
          return;
        }

        const newName = target.value.trim();
        if (!newName) {
          // Cancel edit if empty
          Effect.runPromise(
            Effect.catchAll(cancelEdit(projectId), (error) =>
              Effect.logError(`Failed to cancel edit: ${error}`)
            )
          );
          return;
        }

        // Save on blur
        Effect.runPromise(
          Effect.catchAll(saveProject(projectId, newName), handleSaveError)
        );
      }
    },
    true
  );

  projectsContainer.addEventListener("keydown", (event) => {
    const target = event.target as HTMLInputElement;
    if (
      target.classList.contains("project-name-input") &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      const projectId = target.getAttribute("data-project-id");
      if (!projectId) {
        return;
      }

      const newName = target.value.trim();
      if (!newName) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(saveProject(projectId, newName), handleSaveError)
      );
    }
  });

  // Delete modal handlers
  deleteEntriesBtn.addEventListener("click", () => {
    if (!deleteProjectIdRef) {
      return;
    }

    const ref = deleteProjectIdRef;
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const projectId: string | null = yield* Ref.get(ref);
          if (!projectId) {
            return;
          }

          yield* deleteProject(projectId, true);
          yield* hideDeleteModal();
          const projects = yield* getProjects;
          yield* renderProjects(projects);
        }),
        handleDeleteError
      )
    );
  });

  keepEntriesBtn.addEventListener("click", () => {
    if (!deleteProjectIdRef) {
      return;
    }

    const ref = deleteProjectIdRef;
    Effect.runPromise(
      Effect.catchAll(
        Effect.gen(function* () {
          const projectId: string | null = yield* Ref.get(ref);
          if (!projectId) {
            return;
          }

          yield* deleteProject(projectId, false);
          yield* hideDeleteModal();
          const projects = yield* getProjects;
          yield* renderProjects(projects);
        }),
        handleDeleteError
      )
    );
  });

  cancelDeleteBtn.addEventListener("click", () => {
    Effect.runPromise(hideDeleteModal());
  });
});
