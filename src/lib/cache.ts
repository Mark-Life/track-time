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
 * Global cache storage using Effect Ref
 */
let cacheRef: Ref.Ref<CacheMap> | null = null;

/**
 * Initializes the cache storage
 */
const getCacheRef = (): Effect.Effect<Ref.Ref<CacheMap>, never> =>
  Effect.gen(function* () {
    if (!cacheRef) {
      cacheRef = yield* Ref.make<CacheMap>(new Map());
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
    newCache.set(key, {
      data,
      timestamp: Date.now(),
      etag,
    });
    yield* Ref.set(ref, newCache);
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
    const cached = yield* getCached<T>(key);
    const isFresh = yield* isCachedFresh(key);

    // If we have fresh cached data, return it immediately
    if (cached !== null && isFresh) {
      return cached;
    }

    // Fetch fresh data
    const freshData = yield* fetchFn();
    yield* setCached(key, freshData);

    // If we had stale cached data, return fresh data
    // Otherwise return fresh data (cache miss)
    return freshData;
  });
