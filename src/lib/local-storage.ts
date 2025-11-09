import { Effect } from "effect";
import type { Entry, Timer } from "./types.ts";

const TIMER_KEY = "timer:active";
const ENTRIES_KEY = "entries:pending";

export const saveTimerToLocal = (timer: Timer) =>
  Effect.sync(() => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    } catch (error) {
      throw new Error(`Failed to save timer to localStorage: ${error}`);
    }
  });

export const getTimerFromLocal = () =>
  Effect.sync(() => {
    try {
      const data = localStorage.getItem(TIMER_KEY);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as Timer;
    } catch (error) {
      throw new Error(`Failed to get timer from localStorage: ${error}`);
    }
  });

export const clearLocalTimer = () =>
  Effect.sync(() => {
    try {
      localStorage.removeItem(TIMER_KEY);
    } catch (error) {
      throw new Error(`Failed to clear timer from localStorage: ${error}`);
    }
  });

export const saveEntryToLocal = (entry: Entry) =>
  Effect.gen(function* () {
    const entries = yield* getLocalEntries();
    yield* Effect.sync(() => {
      try {
        entries.push(entry);
        localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
      } catch (error) {
        throw new Error(`Failed to save entry to localStorage: ${error}`);
      }
    });
  });

export const getLocalEntries = () =>
  Effect.sync(() => {
    try {
      const data = localStorage.getItem(ENTRIES_KEY);
      if (!data) {
        return [];
      }
      return JSON.parse(data) as Entry[];
    } catch (error) {
      throw new Error(`Failed to get entries from localStorage: ${error}`);
    }
  });

export const clearLocalEntries = () =>
  Effect.sync(() => {
    try {
      localStorage.removeItem(ENTRIES_KEY);
    } catch (error) {
      throw new Error(`Failed to clear entries from localStorage: ${error}`);
    }
  });

export const updateLocalEntry = (updatedEntry: Entry) =>
  Effect.gen(function* () {
    const entries = yield* getLocalEntries();
    yield* Effect.sync(() => {
      try {
        const index = entries.findIndex((entry) => entry.id === updatedEntry.id);
        if (index === -1) {
          entries.push(updatedEntry);
        } else {
          entries[index] = updatedEntry;
        }
        localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
      } catch (error) {
        throw new Error(`Failed to update entry in localStorage: ${error}`);
      }
    });
  });

export const clearSyncedEntry = (entryId: string) =>
  Effect.gen(function* () {
    const entries = yield* getLocalEntries();
    yield* Effect.sync(() => {
      try {
        const filtered = entries.filter((entry) => entry.id !== entryId);
        if (filtered.length === 0) {
          localStorage.removeItem(ENTRIES_KEY);
        } else {
          localStorage.setItem(ENTRIES_KEY, JSON.stringify(filtered));
        }
      } catch (error) {
        throw new Error(
          `Failed to clear synced entry from localStorage: ${error}`
        );
      }
    });
  });
