import { Effect, Ref } from "effect";
import type { Project, Timer } from "~/lib/types";

export type AppRefs = {
  timerRef: Ref.Ref<Timer | null>;
  intervalRef: Ref.Ref<number | null>;
  projectsRef: Ref.Ref<Project[]>;
  selectedProjectIdRef: Ref.Ref<string | undefined>;
  pendingProjectIdRef: Ref.Ref<string | null>;
};

// Store references for cleanup
let wsInstance: WebSocket | null = null;
export let intervalRefInstance: Ref.Ref<number | null> | null = null;
export let appInitialized = false;
export let appRefs: AppRefs | null = null;

/**
 * Sets the WebSocket instance for cleanup
 */
export const setWebSocketInstance = (ws: WebSocket | null) => {
  wsInstance = ws;
};

/**
 * Gets the WebSocket instance
 */
export const getWebSocketInstance = (): WebSocket | null => wsInstance;

/**
 * Cleanup function for WebSocket and intervals
 */
export const cleanup = Effect.gen(function* () {
  // Close WebSocket if open
  const ws = getWebSocketInstance();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    setWebSocketInstance(null);
  }

  // Clear interval if exists
  if (intervalRefInstance) {
    const intervalId = yield* Ref.get(intervalRefInstance);
    if (intervalId !== null) {
      clearInterval(intervalId);
      yield* Ref.set(intervalRefInstance, null);
    }
  }
});

/**
 * Sets up cleanup listeners on page unload
 */
export const setupCleanupListeners = () => {
  window.addEventListener("beforeunload", () => {
    Effect.runPromise(cleanup);
  });

  window.addEventListener("unload", () => {
    Effect.runPromise(cleanup);
  });
};

/**
 * Creates new app refs for first-time initialization
 */
export const createAppRefs = Effect.gen(function* () {
  const timerRef = yield* Ref.make<Timer | null>(null);
  const intervalRef = yield* Ref.make<number | null>(null);
  const projectsRef = yield* Ref.make<Project[]>([]);
  const selectedProjectIdRef = yield* Ref.make<string | undefined>(undefined);
  const pendingProjectIdRef = yield* Ref.make<string | null>(null);

  const refs: AppRefs = {
    timerRef,
    intervalRef,
    projectsRef,
    selectedProjectIdRef,
    pendingProjectIdRef,
  };

  intervalRefInstance = intervalRef;
  appRefs = refs;
  appInitialized = true;

  return refs;
});
