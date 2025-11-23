import type { Entry } from "~/lib/types.ts";

/**
 * Filters entries for a specific day (based on start date)
 */
export const filterEntriesForDay = (entries: Entry[], date: Date): Entry[] => {
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );

  return entries.filter((entry) => {
    const entryStart = new Date(entry.startedAt);
    return entryStart >= dayStart && entryStart <= dayEnd;
  });
};

/**
 * Splits an entry that crosses midnight into two entries
 */
export const splitEntryAtMidnight = (entry: Entry): Entry[] => {
  const startDate = new Date(entry.startedAt);
  const endDate = new Date(entry.endedAt);
  const startDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );
  const endDay = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );

  // If entry doesn't cross midnight, return as-is
  if (endDay <= startDay) {
    return [entry];
  }

  // Calculate midnight timestamp
  const midnight = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate() + 1,
    0,
    0,
    0,
    0
  );

  // Calculate duration for first part (start to midnight)
  const firstDuration =
    (midnight.getTime() - startDate.getTime()) / (1000 * 60 * 60);

  // Calculate duration for second part (midnight to end)
  const secondDuration =
    (endDate.getTime() - midnight.getTime()) / (1000 * 60 * 60);

  // Create first entry (start to midnight)
  const firstEntry: Entry = {
    id: `${entry.id}-part1`,
    startedAt: entry.startedAt,
    endedAt: midnight.toISOString(),
    duration: firstDuration,
    projectId: entry.projectId,
  };

  // Create second entry (midnight to end)
  const secondEntry: Entry = {
    id: `${entry.id}-part2`,
    startedAt: midnight.toISOString(),
    endedAt: entry.endedAt,
    duration: secondDuration,
    projectId: entry.projectId,
  };

  return [firstEntry, secondEntry];
};

/**
 * Processes entries for a day: filters and splits entries that cross midnight
 */
export const processEntriesForDay = (entries: Entry[], date: Date): Entry[] => {
  const dayEntries = filterEntriesForDay(entries, date);
  const processed: Entry[] = [];

  for (const entry of dayEntries) {
    const split = splitEntryAtMidnight(entry);
    processed.push(...split);
  }

  return processed;
};
