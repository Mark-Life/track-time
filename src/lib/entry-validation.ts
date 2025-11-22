import { Effect } from "effect";

const MAX_DURATION_HOURS = 168; // 1 week (7 days * 24 hours)
const MIN_DURATION_HOURS = 0;

/**
 * Validates entry duration based on start and end times
 * @param startedAt - ISO timestamp string for start time
 * @param endedAt - ISO timestamp string for end time
 * @returns Effect that succeeds if valid, or fails with error message
 */
export const validateEntryDuration = (
  startedAt: string,
  endedAt: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);

    if (Number.isNaN(startedAtDate.getTime())) {
      yield* Effect.fail(new Error("Invalid startedAt format. Expected ISO string."));
    }

    if (Number.isNaN(endedAtDate.getTime())) {
      yield* Effect.fail(new Error("Invalid endedAt format. Expected ISO string."));
    }

    const startTime = startedAtDate.getTime();
    const endTime = endedAtDate.getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    if (duration < MIN_DURATION_HOURS) {
      yield* Effect.fail(
        new Error("End time must be after start time")
      );
    }

    if (duration > MAX_DURATION_HOURS) {
      yield* Effect.fail(
        new Error(`Duration cannot exceed ${MAX_DURATION_HOURS} hours (1 week)`)
      );
    }
  });

/**
 * Validates entry duration from calculated duration value
 * @param duration - Duration in decimal hours
 * @returns Effect that succeeds if valid, or fails with error message
 */
export const validateDurationValue = (
  duration: number
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (duration < MIN_DURATION_HOURS) {
      yield* Effect.fail(
        new Error("Duration cannot be negative")
      );
    }

    if (duration > MAX_DURATION_HOURS) {
      yield* Effect.fail(
        new Error(`Duration cannot exceed ${MAX_DURATION_HOURS} hours (1 week)`)
      );
    }
  });

const MAX_PROJECT_NAME_LENGTH = 100;
const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9\s\-_]+$/;

/**
 * Validates project name for length limits and XSS prevention
 * @param name - Project name to validate
 * @returns Effect that succeeds if valid, or fails with error message
 */
export const validateProjectName = (
  name: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!name || typeof name !== "string") {
      yield* Effect.fail(new Error("Project name is required"));
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }

    if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
      yield* Effect.fail(
        new Error(`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or less`)
      );
    }

    // Prevent XSS - allow only safe characters
    if (!PROJECT_NAME_PATTERN.test(trimmed)) {
      yield* Effect.fail(
        new Error("Project name contains invalid characters. Only letters, numbers, spaces, hyphens, and underscores are allowed.")
      );
    }
  });

