import { Effect, Ref } from "effect";
import type { Timer } from "~/lib/types";
import { showPauseButton, showPlayButton, updateTimerDisplay } from "./dom";

export const formatElapsedTime = (startedAt: string): string => {
  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;

  const hours = Math.floor(elapsed / (1000 * 60 * 60));
  const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const startTimerUI = (
  timerRef: Ref.Ref<Timer | null>,
  intervalRef: Ref.Ref<number | null>
) =>
  Effect.gen(function* () {
    yield* showPauseButton();

    const updateDisplay = Effect.gen(function* () {
      const timer = yield* Ref.get(timerRef);
      if (timer) {
        yield* updateTimerDisplay(formatElapsedTime(timer.startedAt));
      }
    });

    // Update display immediately
    yield* updateDisplay;

    // Clear existing interval if any
    const existingInterval = yield* Ref.get(intervalRef);
    if (existingInterval !== null) {
      clearInterval(existingInterval);
    }

    // Start new interval
    const intervalId = setInterval(() => {
      Effect.runPromise(
        Effect.catchAll(updateDisplay, (error) =>
          Effect.logError(`Timer display update error: ${error}`)
        )
      );
    }, 1000) as unknown as number;

    yield* Ref.set(intervalRef, intervalId);
  });

export const stopTimerUI = (intervalRef: Ref.Ref<number | null>) =>
  Effect.gen(function* () {
    yield* showPlayButton();
    yield* updateTimerDisplay("00:00:00");

    const intervalId = yield* Ref.get(intervalRef);
    if (intervalId !== null) {
      clearInterval(intervalId);
      yield* Ref.set(intervalRef, null);
    }
  });
