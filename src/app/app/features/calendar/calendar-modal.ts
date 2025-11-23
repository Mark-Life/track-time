import { Effect, Ref } from "effect";
import { chevronIcon } from "~/assets/icons";
import {
  type ComboboxOption,
  createCombobox,
  setComboboxValue,
  updateComboboxOptions,
} from "~/components/ui/combobox.ts";
import type { Entry, Project } from "~/lib/types.ts";
import {
  createEntry,
  deleteEntry,
  getEntries,
  updateEntry,
} from "../../api.ts";
import { validateEntryForm } from "../../infra/entry-handlers.ts";
import { showEntryDeleteLoading, showFormError } from "../../ui/dom.ts";
import { renderCalendarDay } from "./calendar-rendering.ts";
import { getCurrentDisplayedDate } from "./calendar-utils.ts";

/**
 * Renders entry edit form in the modal
 */
export const renderEntryEditFormInModal = (
  entry: Entry,
  projects: Project[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const modal = document.getElementById("calendar-entry-modal");
    const modalContent = document.getElementById(
      "calendar-entry-modal-content"
    );
    if (!(modal && modalContent)) {
      return;
    }

    const isoToDatetimeLocal = (isoString: string): string => {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const comboboxId = `calendar-entry-${entry.id}-project-combobox`;
    const comboboxInputId = `calendar-entry-${entry.id}-project-combobox-input`;
    const comboboxListId = `calendar-entry-${entry.id}-project-combobox-list`;
    const hiddenInputId = `calendar-entry-${entry.id}-project-id-hidden`;

    const isNew = entry.id === "temp-new";

    const modalTitleId = `calendar-entry-modal-title-${entry.id}`;
    modalContent.innerHTML = `
      <h3 id="${modalTitleId}" class="text-lg font-bold mb-6">${isNew ? "Create Entry" : "Edit Entry"}</h3>
      <form class="calendar-edit-entry-form space-y-4" data-entry-id="${entry.id}">
        <div class="flex flex-col gap-2">
          <label for="calendar-entry-${entry.id}-start-time" class="text-sm font-medium">Start Time</label>
          <input
            id="calendar-entry-${entry.id}-start-time"
            type="datetime-local"
            name="startedAt"
            value="${isoToDatetimeLocal(entry.startedAt)}"
            required
            class="px-3 py-2 border border-border rounded bg-background text-foreground"
            aria-label="Start time for time entry"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="calendar-entry-${entry.id}-end-time" class="text-sm font-medium">End Time</label>
          <input
            id="calendar-entry-${entry.id}-end-time"
            type="datetime-local"
            name="endedAt"
            value="${isoToDatetimeLocal(entry.endedAt)}"
            required
            class="px-3 py-2 border border-border rounded bg-background text-foreground"
            aria-label="End time for time entry"
          />
        </div>
        <div class="flex flex-col gap-2 mb-4 relative">
          <label for="${comboboxInputId}" class="text-sm font-medium">Project</label>
          <div
            id="${comboboxId}"
            class="combobox-container relative z-50"
            role="combobox"
            aria-expanded="false"
            aria-haspopup="listbox"
          >
            <div
              class="flex items-center border border-border rounded bg-background cursor-pointer"
            >
              <input
                id="${comboboxInputId}"
                type="text"
                placeholder="No project"
                autocomplete="off"
                class="flex-1 px-3 py-2 bg-transparent text-foreground outline-none"
                aria-autocomplete="list"
                aria-controls="${comboboxListId}"
                role="combobox"
              />
              <button
                data-combobox-button
                type="button"
                class="px-2 py-2 text-muted-foreground hover:text-foreground transition"
                aria-label="Toggle project list"
              >
                ${chevronIcon(16)}
              </button>
            </div>
            <div
            id="${comboboxListId}"
            class="relative w-full mt-1 border border-border rounded bg-popover shadow-lg max-h-96 overflow-auto hidden"
            role="listbox"
          ></div>
          </div>
          <input
            type="hidden"
            name="projectId"
            id="${hiddenInputId}"
          />
        </div>
        <div class="flex gap-2 justify-between">
          <div>
            ${
              isNew
                ? ""
                : `
            <button
              type="button"
              class="calendar-modal-delete-btn px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/80 cursor-pointer"
              data-entry-id="${entry.id}"
              aria-label="Delete time entry"
            >
              Delete
            </button>
            `
            }
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="calendar-cancel-edit-btn px-4 py-2 border border-border rounded hover:bg-muted cursor-pointer"
              data-entry-id="${entry.id}"
              aria-label="Cancel editing entry"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="calendar-save-edit-btn px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/80 cursor-pointer"
              data-entry-id="${entry.id}"
              aria-label="${isNew ? "Create time entry" : "Save changes to time entry"}"
            >
              ${isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </form>
    `;

    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", modalTitleId);
    modal.classList.remove("hidden");

    // Focus first input when modal opens
    const firstInput = modalContent.querySelector<HTMLInputElement>(
      'input[type="datetime-local"]'
    );
    if (firstInput) {
      firstInput.focus();
    }

    // Initialize combobox
    const projectOptions: ComboboxOption[] = [
      { value: "", label: "No project" },
      ...(projects || []).map((p) => ({ value: p.id, label: p.name })),
    ];

    yield* createCombobox({
      containerId: comboboxId,
      inputId: comboboxInputId,
      listId: comboboxListId,
      placeholder: "No project",
      emptyText: "No projects found",
      onSelect: (value) =>
        Effect.sync(() => {
          const hiddenInput = document.getElementById(
            hiddenInputId
          ) as HTMLInputElement;
          if (hiddenInput) {
            hiddenInput.value = value ?? "";
          }
        }),
    });

    yield* updateComboboxOptions(comboboxId, projectOptions);
    yield* setComboboxValue(comboboxId, entry.projectId || "");
  });

/**
 * Closes the calendar entry modal
 */
export const closeCalendarModal = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const modal = document.getElementById("calendar-entry-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.removeAttribute("role");
      modal.removeAttribute("aria-modal");
      modal.removeAttribute("aria-labelledby");
    }
  });

/**
 * Refreshes calendar view after entry changes
 */
const refreshCalendarView = (refs: {
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      const entries: Entry[] = yield* getEntries;
      yield* Ref.set(refs.entriesRef, entries);
      const projects: Project[] = yield* Ref.get(refs.projectsRef);
      const currentDate = getCurrentDisplayedDate();
      yield* renderCalendarDay(entries, projects, currentDate);
    }),
    (error) => Effect.logError(`Failed to refresh calendar: ${error}`)
  );

/**
 * Handles create entry from modal
 */
const handleModalCreate = (params: {
  startedAt: string;
  endedAt: string;
  projectId: string | undefined;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
  form: HTMLFormElement;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* createEntry(params.startedAt, params.endedAt, params.projectId);
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to create entry: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to create entry";
        yield* showFormError(params.form, errorMessage);
      })
  );

/**
 * Handles update entry from modal
 */
const handleModalUpdate = (params: {
  entryId: string;
  startedAt: string;
  endedAt: string;
  projectId: string | undefined;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
  form: HTMLFormElement;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* updateEntry(
        params.entryId,
        params.startedAt,
        params.endedAt,
        params.projectId
      );
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to update entry: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to update entry";
        yield* showFormError(params.form, errorMessage);
      })
  );

/**
 * Handles delete entry from modal
 */
const handleModalDelete = (params: {
  entryId: string;
  entriesRef: Ref.Ref<Entry[]>;
  projectsRef: Ref.Ref<Project[]>;
}): Effect.Effect<void> =>
  Effect.catchAll(
    Effect.gen(function* () {
      yield* showEntryDeleteLoading(params.entryId);
      yield* deleteEntry(params.entryId);
      yield* closeCalendarModal();
      yield* refreshCalendarView({
        entriesRef: params.entriesRef,
        projectsRef: params.projectsRef,
      });
    }),
    (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Failed to delete entry: ${error}`);
        yield* closeCalendarModal();
        yield* refreshCalendarView({
          entriesRef: params.entriesRef,
          projectsRef: params.projectsRef,
        });
      })
  );

/**
 * Sets up modal handlers (form submission, cancel, click outside, Escape key)
 */
export const setupModalHandlers = (
  entriesRef: Ref.Ref<Entry[]>,
  projectsRef: Ref.Ref<Project[]>
): Effect.Effect<void> =>
  Effect.sync(() => {
    // Handle form validation and submission
    const processFormSubmission = (form: HTMLFormElement): void => {
      const entryId = form.getAttribute("data-entry-id");
      if (!entryId) {
        return;
      }

      const validation = validateEntryForm(form);
      if (!validation.valid) {
        Effect.runPromise(showFormError(form, validation.error));
        return;
      }

      const isNew = entryId === "temp-new";
      const params = {
        startedAt: validation.startedAt,
        endedAt: validation.endedAt,
        projectId: validation.projectId,
        entriesRef,
        projectsRef,
        form,
      };

      if (isNew) {
        Effect.runPromise(handleModalCreate(params));
        return;
      }

      Effect.runPromise(handleModalUpdate({ ...params, entryId }));
    };

    // Handle modal form submission (using event delegation)
    const handleFormSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      if (!form.classList.contains("calendar-edit-entry-form")) {
        return;
      }

      event.preventDefault();
      processFormSubmission(form);
    };

    // Handle cancel button
    const handleCancelClick = (): void => {
      Effect.runPromise(closeCalendarModal());
    };

    // Handle delete button
    const handleDeleteClick = (entryId: string): void => {
      Effect.runPromise(
        handleModalDelete({ entryId, entriesRef, projectsRef })
      );
    };

    // Process modal click actions
    const processModalClick = (target: HTMLElement): void => {
      const cancelBtn = target.closest(".calendar-cancel-edit-btn");
      if (cancelBtn) {
        handleCancelClick();
        return;
      }

      const deleteBtn = target.closest(".calendar-modal-delete-btn");
      if (deleteBtn) {
        const entryId = deleteBtn.getAttribute("data-entry-id");
        if (entryId) {
          handleDeleteClick(entryId);
        }
        return;
      }

      // Close modal when clicking outside
      if (target.id === "calendar-entry-modal") {
        handleCancelClick();
      }
    };

    // Handle cancel button, delete button, and click outside
    const handleModalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const modal = document.getElementById("calendar-entry-modal");
      if (!modal || modal.classList.contains("hidden")) {
        return;
      }

      processModalClick(target);
    };

    // Handle Escape key to close modal
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const modal = document.getElementById("calendar-entry-modal");
      if (!modal || modal.classList.contains("hidden")) {
        return;
      }

      event.preventDefault();
      handleCancelClick();
    };

    // Set up event listeners (only once)
    document.addEventListener("submit", handleFormSubmit);
    document.addEventListener("click", handleModalClick);
    document.addEventListener("keydown", handleEscapeKey);
  });
