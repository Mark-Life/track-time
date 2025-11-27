import { Effect, Ref } from "effect";
import type { Project } from "~/lib/types";
import { deleteEntry, getEntries, updateEntry } from "../api";
import {
  removeEntryDeleteLoading,
  removeEntrySaveLoading,
  renderEntries,
  renderEntryEditForm,
  renderEntryView,
  showEntryDeleteLoading,
  showEntrySaveLoading,
  showFormError,
} from "../ui/dom";

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
    projectIdInput && projectIdInput.trim() !== "" ? projectIdInput : undefined;

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

  const startTime = startedAtDate.getTime();
  const endTime = endedAtDate.getTime();
  const duration = (endTime - startTime) / (1000 * 60 * 60);
  const MAX_DURATION_HOURS = 168; // 1 week

  if (duration > MAX_DURATION_HOURS) {
    return {
      valid: false,
      error: `Duration cannot exceed ${MAX_DURATION_HOURS} hours (1 week)`,
    };
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
      event.stopPropagation();
      const entryId = editBtn.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const entries = yield* getEntries;
            const entry = entries.find((e) => e.id === entryId);
            const projects: Project[] = yield* Ref.get(projectsRef);
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
            const currentProjects: Project[] = yield* Ref.get(projectsRef);
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
      event.stopPropagation();
      const entryId = deleteBtn.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            // Show loading state immediately
            yield* showEntryDeleteLoading(entryId);

            yield* deleteEntry(entryId);
            const entries = yield* getEntries;
            const currentProjects: Project[] = yield* Ref.get(projectsRef);
            yield* renderEntries(entries, currentProjects);
          }),
          (error) =>
            Effect.gen(function* () {
              yield* Effect.logError(`Failed to delete entry: ${error}`);
              // Remove loading state on error
              yield* removeEntryDeleteLoading(entryId);
            })
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
          // Show loading state immediately
          yield* showEntrySaveLoading(entryId);

          const updatedEntry = yield* updateEntry(
            entryId,
            validation.startedAt,
            validation.endedAt,
            validation.projectId
          );
          // Remove loading state before rendering (renderEntryView replaces the element)
          yield* removeEntrySaveLoading(entryId);
          const currentProjects: Project[] = yield* Ref.get(projectsRef);
          yield* renderEntryView(updatedEntry, currentProjects);
        }),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logError(`Failed to update entry: ${error}`);
            // Remove loading state on error
            yield* removeEntrySaveLoading(entryId);
            const errorMessage =
              error instanceof Error ? error.message : "Failed to update entry";
            yield* showFormError(form, errorMessage);
            const entries = yield* getEntries;
            const currentProjects: Project[] = yield* Ref.get(projectsRef);
            yield* renderEntries(entries, currentProjects);
          })
      )
    );
  });
};
