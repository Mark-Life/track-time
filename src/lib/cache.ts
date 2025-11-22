import { Effect, Ref } from "effect";

/**
 * Cache entry storing data with timestamp and optional ETag
 */
type CacheEntry<T> = {
  data: T;
  timestamp: number;
  etag?: string;
};

/**
 * Cache storage map type
 */
type CacheMap = Map<string, CacheEntry<unknown>>;

/**
 * Cache keys for different endpoints
 */
export const CacheKeys = {
  projects: "projects",
  entries: "entries",
  timer: "timer",
  user: "user",
} as const;

/**
 * TTL configuration per endpoint (in milliseconds)
 */
const TTL_CONFIG: Record<string, number> = {
  [CacheKeys.projects]: 5 * 60 * 1000, // 5 minutes
  [CacheKeys.entries]: 60 * 1000, // 1 minute
  [CacheKeys.timer]: 10 * 1000, // 10 seconds
  [CacheKeys.user]: 10 * 60 * 1000, // 10 minutes
};

/**
 * localStorage key prefix for cache persistence
 */
const STORAGE_PREFIX = "log-time-cache:";

/**
 * Global cache storage using Effect Ref
 */
let cacheRef: Ref.Ref<CacheMap> | null = null;

/**
 * Restores cache from localStorage
 */
const restoreCacheFromStorage = (): CacheMap => {
  const restored = new Map<string, CacheEntry<unknown>>();

  try {
    for (const key of Object.values(CacheKeys)) {
      const storageKey = `${STORAGE_PREFIX}${key}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const entry = JSON.parse(stored) as CacheEntry<unknown>;
          // Validate TTL before restoring
          const ttl = TTL_CONFIG[key] ?? 0;
          const age = Date.now() - entry.timestamp;
          if (age <= ttl) {
            restored.set(key, entry);
          } else {
            // Remove expired entry from storage
            localStorage.removeItem(storageKey);
          }
        } catch {
          // Invalid JSON, remove it
          localStorage.removeItem(storageKey);
        }
      }
    }
  } catch {
    // localStorage not available or error, return empty map
  }

  return restored;
};

/**
 * Persists cache entry to localStorage
 */
const persistCacheEntry = <T>(key: string, entry: CacheEntry<T>): void => {
  try {
    const storageKey = `${STORAGE_PREFIX}${key}`;
    localStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    // localStorage not available or quota exceeded, silently fail
  }
};

/**
 * Removes cache entry from localStorage
 */
const removeCacheEntryFromStorage = (key: string): void => {
  try {
    const storageKey = `${STORAGE_PREFIX}${key}`;
    localStorage.removeItem(storageKey);
  } catch {
    // localStorage not available, silently fail
  }
};

/**
 * Initializes the cache storage and restores from localStorage
 */
const getCacheRef = (): Effect.Effect<Ref.Ref<CacheMap>, never> =>
  Effect.gen(function* () {
    if (!cacheRef) {
      const restored = restoreCacheFromStorage();
      cacheRef = yield* Ref.make<CacheMap>(restored);
    }
    return cacheRef;
  });

/**
 * Gets cached data if it exists and is not expired
 */
export const getCached = <T>(key: string): Effect.Effect<T | null, never> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    const cache: CacheMap = yield* Ref.get(ref);
    const entry = cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    const ttl = TTL_CONFIG[key] ?? 0;
    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > ttl) {
      // Cache expired, remove it
      const newCache: CacheMap = new Map(cache);
      newCache.delete(key);
      yield* Ref.set(ref, newCache);
      // Remove from localStorage
      removeCacheEntryFromStorage(key);
      return null;
    }

    return entry.data;
  });

/**
 * Sets cached data with optional ETag
 */
export const setCached = <T>(
  key: string,
  data: T,
  etag?: string
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    const cache: CacheMap = yield* Ref.get(ref);
    const newCache: CacheMap = new Map(cache);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      etag,
    };
    newCache.set(key, entry);
    yield* Ref.set(ref, newCache);
    // Persist to localStorage
    persistCacheEntry(key, entry);
  });

/**
 * Invalidates cache for one or more keys
 */
export const invalidateCache = (
  key: string | string[]
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    const cache: CacheMap = yield* Ref.get(ref);
    const newCache: CacheMap = new Map(cache);
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      newCache.delete(k);
      // Remove from localStorage
      removeCacheEntryFromStorage(k);
    }
    yield* Ref.set(ref, newCache);
  });

/**
 * Clears all cached data
 */
export const clearCache = (): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    yield* Ref.set(ref, new Map());
    // Clear all cache entries from localStorage
    try {
      for (const key of Object.values(CacheKeys)) {
        removeCacheEntryFromStorage(key);
      }
    } catch {
      // localStorage not available, silently fail
    }
  });

/**
 * Checks if cached data exists and is fresh
 */
export const isCachedFresh = (key: string): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    const cache: CacheMap = yield* Ref.get(ref);
    const entry = cache.get(key) as CacheEntry<unknown> | undefined;

    if (!entry) {
      return false;
    }

    const ttl = TTL_CONFIG[key] ?? 0;
    const now = Date.now();
    const age = now - entry.timestamp;

    return age <= ttl;
  });

/**
 * Gets cached data with stale-while-revalidate support
 * Returns cached data immediately if available (even if stale),
 * then fetches fresh data in background
 */
export const getCachedWithRevalidate = <T>(
  key: string,
  fetchFn: () => Effect.Effect<T, Error>
): Effect.Effect<T, Error> =>
  Effect.gen(function* () {
    const ref = yield* getCacheRef();
    const cache: CacheMap = yield* Ref.get(ref);
    const entry = cache.get(key) as CacheEntry<T> | undefined;

    // If we have cached data (fresh or stale), return it immediately
    // and fetch fresh data in background
    if (entry) {
      // Start background fetch (fire and forget)
      Effect.runPromise(
        Effect.catchAll(
          Effect.gen(function* () {
            const freshData = yield* fetchFn();
            yield* setCached(key, freshData);
          }),
          (error) => Effect.logError(`Background revalidation failed: ${error}`)
        )
      );

      // Return cached data immediately (even if stale)
      return entry.data;
    }

    // No cache, fetch fresh data
    const freshData = yield* fetchFn();
    yield* setCached(key, freshData);
    return freshData;
  });
