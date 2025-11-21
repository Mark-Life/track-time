import { Effect, Ref } from "effect";
import type { Project } from "~/lib/types.ts";
import { deleteEntry, getEntries, updateEntry } from "./api.ts";
import {
  renderEntries,
  renderEntryEditForm,
  renderEntryView,
  showFormError,
} from "./dom.ts";
import type { AppRefs } from "./app-state.ts";

/**
 * Validates entry form data
 */
export const validateEntryForm = (
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

/**
 * Sets up entry click handlers (edit, cancel, delete)
 */
export const setupEntryClickHandlers = (
  entriesList: HTMLElement,
  projectsRef: Ref.Ref<Project[]>
) => {
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
};

/**
 * Sets up entry form submission handler
 */
export const setupEntryFormHandler = (
  entriesList: HTMLElement,
  projectsRef: Ref.Ref<Project[]>
) => {
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
};

