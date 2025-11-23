import type { Entry } from "~/lib/types.ts";

/**
 * Finds the minimum hour from entries
 */
const findMinHour = (entries: Entry[]): number => {
  let minHour = 23;
  for (const entry of entries) {
    const startDate = new Date(entry.startedAt);
    const startHour = startDate.getHours();
    if (startHour < minHour) {
      minHour = startHour;
    }
  }
  return minHour;
};

/**
 * Finds the maximum hour from entries
 */
const findMaxHour = (entries: Entry[]): number => {
  let maxHour = 0;
  for (const entry of entries) {
    const endDate = new Date(entry.endedAt);
    const endHour = endDate.getHours();
    if (endHour > maxHour) {
      maxHour = endHour;
    }
  }
  return maxHour;
};

/**
 * Determines the time range to display based on entries
 * Returns { startHour, endHour } where startHour is 0-23 and endHour is 0-23
 */
export const determineTimeRange = (
  entries: Entry[]
): { startHour: number; endHour: number } => {
  if (entries.length === 0) {
    // Default: 6 AM to 10 PM (22:00)
    return { startHour: 6, endHour: 22 };
  }

  const minHour = findMinHour(entries);
  const maxHour = findMaxHour(entries);

  // If there are entries before 6 AM, show from midnight (0)
  // Otherwise, start at 6 AM
  const startHour = minHour < 6 ? 0 : 6;

  // If there are entries after 10 PM (22:00), show until midnight (23)
  // Otherwise, end at 10 PM (22:00)
  const endHour = maxHour >= 22 ? 23 : 22;

  return { startHour, endHour };
};
