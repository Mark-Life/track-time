import { Effect } from "effect";

export type ComboboxOption<T = string> = {
  value: T;
  label: string;
};

type ComboboxContainer<T = string> = HTMLDivElement & {
  __comboboxUpdateOptions: (options: ComboboxOption<T>[]) => void;
  __comboboxSetValue: (value: T | undefined) => void;
};

export type ComboboxConfig<T = string> = {
  containerId: string;
  inputId: string;
  listId: string;
  placeholder?: string;
  emptyText?: string;
  onSelect: (value: T | undefined) => Effect.Effect<void>;
};

export const createCombobox = <T = string>(
  config: ComboboxConfig<T>
): Effect.Effect<void> =>
  Effect.sync(() => {
    const container = document.getElementById(config.containerId);
    if (!container) {
      throw new Error(`Container with id "${config.containerId}" not found`);
    }

    const input = container.querySelector(
      `#${config.inputId}`
    ) as HTMLInputElement;
    const list = container.querySelector(`#${config.listId}`) as HTMLDivElement;
    const button = container.querySelector(
      "[data-combobox-button]"
    ) as HTMLButtonElement;

    if (!(input && list && button)) {
      throw new Error("Combobox elements not found");
    }

    // Find the wrapper div (parent of input and button)
    const wrapper = input.parentElement as HTMLDivElement;
    if (!wrapper) {
      throw new Error("Combobox wrapper element not found");
    }

    let isOpen = false;
    let selectedIndex = -1;
    let filteredOptions: ComboboxOption<T>[] = [];
    let allOptions: ComboboxOption<T>[] = [];

    const updateOptions = (options: ComboboxOption<T>[]) => {
      allOptions = options;
      filterOptions();
    };

    const filterOptions = () => {
      const searchTerm = input.value.toLowerCase().trim();
      if (searchTerm === "") {
        filteredOptions = allOptions;
      } else {
        filteredOptions = allOptions.filter((option) =>
          option.label.toLowerCase().includes(searchTerm)
        );
      }
      renderList();
    };

    const renderList = () => {
      if (filteredOptions.length === 0) {
        list.innerHTML = `<div class="px-3 py-2 text-sm text-muted-foreground">${
          config.emptyText || "No options found"
        }</div>`;
        return;
      }

      list.innerHTML = filteredOptions
        .map(
          (option, index) => `
        <div
          class="combobox-option px-3 py-2 text-sm cursor-pointer hover:bg-muted ${
            index === selectedIndex ? "bg-muted" : ""
          }"
          data-value="${String(option.value)}"
          data-index="${index}"
          role="option"
          ${index === selectedIndex ? 'aria-selected="true"' : ""}
        >
          ${option.label}
        </div>
      `
        )
        .join("");
    };

    const open = () => {
      isOpen = true;
      container.classList.add("combobox-open");
      list.classList.remove("hidden");
      button.setAttribute("aria-expanded", "true");
      input.focus();
      filterOptions();
    };

    const close = () => {
      isOpen = false;
      selectedIndex = -1;
      container.classList.remove("combobox-open");
      list.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
      input.blur();
    };

    const selectOption = (option: ComboboxOption<T> | undefined) => {
      if (option) {
        input.value = option.label;
        Effect.runPromise(config.onSelect(option.value));
      } else {
        input.value = "";
        Effect.runPromise(config.onSelect(undefined));
      }
      close();
    };

    const selectByIndex = (index: number) => {
      if (index >= 0 && index < filteredOptions.length) {
        selectedIndex = index;
        renderList();
        const optionElement = list.querySelector(
          `[data-index="${index}"]`
        ) as HTMLElement;
        if (optionElement) {
          optionElement.scrollIntoView({ block: "nearest" });
        }
      }
    };

    const handleKeyDownWhenClosed = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };

    const handleArrowDown = () => {
      selectedIndex =
        selectedIndex < filteredOptions.length - 1 ? selectedIndex + 1 : 0;
      selectByIndex(selectedIndex);
    };

    const handleArrowUp = () => {
      selectedIndex =
        selectedIndex > 0 ? selectedIndex - 1 : filteredOptions.length - 1;
      selectByIndex(selectedIndex);
    };

    const handleEnter = () => {
      if (selectedIndex >= 0 && selectedIndex < filteredOptions.length) {
        selectOption(filteredOptions[selectedIndex]);
      } else if (filteredOptions.length === 1) {
        selectOption(filteredOptions[0]);
      }
    };

    const handleKeyDownWhenOpen = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        handleArrowDown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        handleArrowUp();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleEnter();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    // Wrapper click handler - makes entire area clickable
    wrapper.addEventListener("click", (e) => {
      // Don't interfere with input or button clicks
      if (
        e.target === input ||
        e.target === button ||
        button.contains(e.target as Node)
      ) {
        return;
      }
      // Click on wrapper area opens combobox if closed
      if (!isOpen) {
        open();
      }
    });

    // Button click handler
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isOpen) {
        close();
      } else {
        open();
      }
    });

    // Input handlers
    input.addEventListener("input", () => {
      selectedIndex = -1;
      filterOptions();
      if (!isOpen) {
        open();
      }
    });

    input.addEventListener("focus", () => {
      if (!isOpen) {
        open();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (!isOpen) {
        handleKeyDownWhenClosed(e);
        return;
      }
      handleKeyDownWhenOpen(e);
    });

    // List click handler (event delegation)
    list.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const option = target.closest(".combobox-option") as HTMLElement;
      if (option) {
        const value = option.getAttribute("data-value");
        const selectedOption = filteredOptions.find(
          (opt) => String(opt.value) === value
        );
        selectOption(selectedOption);
      }
    });

    // Click outside to close
    document.addEventListener("click", (e) => {
      if (!container.contains(e.target as Node)) {
        close();
      }
    });

    // Expose updateOptions method on container
    const comboboxContainer = container as ComboboxContainer<T>;
    comboboxContainer.__comboboxUpdateOptions = updateOptions;
    comboboxContainer.__comboboxSetValue = (value: T | undefined) => {
      const option = allOptions.find((opt) => opt.value === value);
      if (option) {
        input.value = option.label;
      } else {
        input.value = "";
      }
    };
  });

export const updateComboboxOptions = <T = string>(
  containerId: string,
  options: ComboboxOption<T>[]
): Effect.Effect<void> =>
  Effect.sync(() => {
    const container = document.getElementById(
      containerId
    ) as ComboboxContainer<T> | null;
    container?.__comboboxUpdateOptions?.(options);
  });

export const setComboboxValue = <T = string>(
  containerId: string,
  value: T | undefined
): Effect.Effect<void> =>
  Effect.sync(() => {
    const container = document.getElementById(
      containerId
    ) as ComboboxContainer<T> | null;
    container?.__comboboxSetValue?.(value);
  });
