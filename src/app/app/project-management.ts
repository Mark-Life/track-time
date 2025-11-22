import { Effect, Ref } from "effect";
import {
  type ComboboxOption,
  createCombobox,
  setComboboxValue,
  updateComboboxOptions,
} from "~/components/ui/combobox.ts";
import type { Project, Timer } from "~/lib/types.ts";
import { getProjects, updateTimer } from "./api.ts";
import type { AppRefs } from "./app-state.ts";

/**
 * Populates project combobox with projects
 */
export const populateProjectCombobox = (
  projects: Project[],
  selectedId?: string
) =>
  Effect.gen(function* () {
    const options: ComboboxOption<string>[] = [
      { value: "", label: "No project" },
      ...projects.map((project) => ({
        value: project.id,
        label: project.name,
      })),
    ];
    yield* updateComboboxOptions("project-combobox", options);
    yield* setComboboxValue("project-combobox", selectedId ?? "");
  });

/**
 * Loads projects and populates combobox
 */
export const loadProjects = Effect.gen(function* () {
  const projects = yield* getProjects;
  yield* populateProjectCombobox(projects);
  return projects;
});

/**
 * Updates timer with new project
 */
export const updateTimerForProject = (
  timer: Timer,
  projectId: string | undefined,
  ref: Ref.Ref<Timer | null>
) =>
  Effect.gen(function* () {
    yield* Effect.log(
      `Timer is running, updating project from ${timer.projectId ?? "none"} to ${projectId ?? "none"}`
    );
    const updatedTimer = yield* updateTimer(projectId);
    if (updatedTimer) {
      yield* Ref.set(ref, updatedTimer);
      yield* Effect.log("Timer updated successfully");
    }
  });

/**
 * Handles project selection from combobox
 */
export const handleProjectSelection = (
  value: string | undefined,
  timerRef: Ref.Ref<Timer | null>,
  selectedProjectIdRef: Ref.Ref<string | undefined>
) =>
  Effect.gen(function* () {
    // Convert empty string to undefined for "No project"
    const projectId = value === "" ? undefined : value;
    yield* Effect.log(
      `Project selected: ${projectId ?? "none"} (${projectId ? "setting project" : "clearing project"})`
    );
    yield* Ref.set(selectedProjectIdRef, projectId);
    // If timer is running, update it with the new project
    const timer: Timer | null = yield* Ref.get(timerRef);
    if (timer) {
      yield* updateTimerForProject(timer, projectId, timerRef);
    } else {
      yield* Effect.log("No active timer, skipping update");
    }
  });

/**
 * Initializes project combobox
 */
export const initializeProjectCombobox = (
  timerRef: Ref.Ref<Timer | null>,
  selectedProjectIdRef: Ref.Ref<string | undefined>
) =>
  Effect.gen(function* () {
    yield* createCombobox({
      containerId: "project-combobox",
      inputId: "project-combobox-input",
      listId: "project-combobox-list",
      placeholder: "No project",
      emptyText: "No projects found",
      onSelect: (value) =>
        Effect.catchAll(
          handleProjectSelection(value, timerRef, selectedProjectIdRef),
          (error) =>
            Effect.gen(function* () {
              yield* Effect.logError(
                `Failed to handle project selection: ${error}`
              );
            })
        ),
    });
  });

/**
 * Sets up project creation handlers
 */
export const setupProjectCreationHandlers = (
  refs: AppRefs,
  elements: {
    container: HTMLElement;
    input: HTMLInputElement;
    submitBtn: HTMLButtonElement;
  },
  createProjectFn: (
    name: string
  ) => Effect.Effect<Project, Error | { error: string }>
) => {
  const handleProjectCreate = () =>
    Effect.gen(function* () {
      const name = elements.input.value.trim();
      if (!name) {
        elements.container.classList.add("hidden");
        elements.input.value = "";
        return;
      }

      try {
        const project = yield* createProjectFn(name);
        // Store the project ID so WebSocket handler can select it
        yield* Ref.set(refs.pendingProjectIdRef, project.id);
        elements.container.classList.add("hidden");
        elements.input.value = "";
        // Project will be added via WebSocket message
      } catch (error) {
        yield* Ref.set(refs.pendingProjectIdRef, null);
        yield* Effect.logError(`Failed to create project: ${error}`);
        console.error(
          error instanceof Error ? error.message : "Failed to create project"
        );
      }
    });

  elements.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      Effect.runPromise(
        Effect.catchAll(handleProjectCreate(), (error) =>
          Effect.logError(`Failed to create project: ${error}`)
        )
      );
    } else if (e.key === "Escape") {
      elements.container.classList.add("hidden");
      elements.input.value = "";
    }
  });

  elements.input.addEventListener("blur", () => {
    // Just hide the input container and clear the value on blur
    // Project creation only happens via submit button or Enter key
    elements.container.classList.add("hidden");
    elements.input.value = "";
  });

  elements.submitBtn.addEventListener("click", () => {
    Effect.runPromise(
      Effect.catchAll(handleProjectCreate(), (error) =>
        Effect.logError(`Failed to create project: ${error}`)
      )
    );
  });
};
