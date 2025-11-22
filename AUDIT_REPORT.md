# Security & Code Quality Audit Report

## 🔴 Critical Security Issues

### 1. **Sensitive Data Exposure in Logs**
**Location:** Multiple files (63 console.log statements found)

**Issue:** Console logs expose sensitive information including:
- Authentication tokens (`src/lib/auth/auth.ts:34-50`)
- Cookie headers (`src/lib/auth/auth.ts:34`)
- Request headers (`src/api/auth.ts:107-111`)
- User emails (`src/api/auth.ts:117`)

**Risk:** In production, these logs could expose user tokens, making session hijacking possible.

**Recommendation:**
```typescript
// Replace debug logs with structured logging
// Use environment-based log levels
const logDebug = (message: string, data?: unknown) => {
  if (process.env.NODE_ENV === "development") {
    console.log(message, data);
  }
};

// Never log sensitive data
// Instead of: console.log("Token:", token)
// Use: console.log("Token present:", !!token)
```

**Files to fix:**
- `src/lib/auth/auth.ts` (lines 34, 36, 40, 46, 50, 259, 276)
- `src/api/auth.ts` (lines 102-111, 115-161)
- `src/server/index.ts` (line 70)
- `src/server/routes.ts` (lines 61, 64, 68)

### 2. **Missing Input Validation on Project Names**
**Location:** `src/api/projects.ts`

**Issue:** Project names are not validated for:
- Length limits (could cause DoS via large strings)
- XSS prevention (special characters)
- SQL injection (if using SQL later)

**Recommendation:**
```typescript
const validateProjectName = (name: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!name || typeof name !== "string") {
      yield* Effect.fail(new Error("Project name is required"));
    }
    
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }
    
    if (trimmed.length > 100) {
      yield* Effect.fail(new Error("Project name must be 100 characters or less"));
    }
    
    // Prevent XSS - allow only safe characters
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(trimmed)) {
      yield* Effect.fail(new Error("Project name contains invalid characters"));
    }
  });
```

### 3. **No Rate Limiting on Non-Auth Endpoints**
**Location:** `src/api/timer.ts`, `src/api/entries.ts`, `src/api/projects.ts`

**Issue:** Only authentication endpoints have rate limiting. Other endpoints (timer, entries, projects) are vulnerable to:
- DoS attacks
- Resource exhaustion
- API abuse

**Recommendation:** Implement rate limiting middleware for all state-changing endpoints:
```typescript
export const rateLimitApi = (
  req: Request,
  endpoint: string
): Effect.Effect<void, Error> => {
  // Similar to rateLimitAuth but for general API endpoints
  // Use IP-based limiting with sliding window
};
```

### 4. **CSRF Token Reuse Prevention**
**Location:** `src/lib/auth/csrf.ts:59-66`

**Issue:** CSRF tokens are deleted after use (good), but there's a race condition window where:
- Token could be used twice if requests arrive simultaneously
- No atomic check-and-delete operation

**Recommendation:** Use Redis atomic operations:
```typescript
// Use Redis GETDEL or Lua script for atomic check-and-delete
const isValid = yield* Effect.tryPromise({
  try: async () => {
    const result = await redis.getdel(key); // Atomic get and delete
    return result === "1";
  },
  catch: (error) => new Error(`Failed to validate CSRF token: ${error}`),
});
```

### 5. **WebSocket Authentication Weakness**
**Location:** `src/server/index.ts:196-220`

**Issue:** WebSocket upgrade validates token but doesn't verify:
- Token hasn't been revoked
- User still exists
- User hasn't been disabled

**Recommendation:** Add user status check:
```typescript
const payload = await Effect.runPromise(verify(token));
const user = await Effect.runPromise(getUserById(payload.userId));
if (!user || user.disabled) {
  return new Response("Unauthorized", { status: 401 });
}
```

## 🟡 Security Concerns

### 6. **JWT Secret Validation**
**Location:** `src/lib/auth/jwt.ts:42-46`

**Issue:** Only checks length (32 chars), doesn't verify entropy or complexity.

**Recommendation:** Add entropy check or use a proper secret generator.

### 7. **Cookie Security**
**Location:** `src/lib/auth/auth.ts:252-279`

**Issue:** Secure flag only added in production. In development, cookies are sent over HTTP, which is fine, but the logic could be clearer.

**Recommendation:** Document this behavior clearly and consider using `SameSite=Strict` for auth cookies (currently `Lax`).

### 8. **Error Message Information Disclosure**
**Location:** Multiple API handlers

**Issue:** Some error messages reveal too much:
- "User not found" vs "Invalid credentials" (helps attackers enumerate users)
- Stack traces in development could leak in production

**Recommendation:** Use generic error messages for auth failures:
```typescript
// Instead of: "User not found"
// Use: "Invalid email or password" (same message for both cases)
```

## 🟠 Code Quality Issues

### 9. **Mixing Sync and Async Patterns**
**Location:** `src/app/app/api.ts` (13 instances)

**Issue:** `Effect.runSync` used in error handlers within async Effect chains:
```typescript
catch: (error) => {
  Effect.runSync(saveTimerToLocal(timer)); // ❌ Sync in async context
  return new Error(`Failed to start timer: ${error}`);
}
```

**Problem:** This breaks Effect's error handling guarantees and can cause issues.

**Recommendation:** Keep everything in Effect:
```typescript
catch: (error) =>
  Effect.gen(function* () {
    yield* saveTimerToLocal(timer);
    return new Error(`Failed to start timer: ${error}`);
  })
```

**Files:** `src/app/app/api.ts` lines 141, 165, 222, 223, 248, 249, 311, 335, 428, 452, 483

### 10. **Inconsistent Error Handling**
**Location:** Multiple files

**Issue:** Some handlers use `Effect.catchAll`, others use try-catch, some don't handle errors at all.

**Recommendation:** Standardize on Effect error handling:
```typescript
// Create a standard error handler
const handleApiError = (error: unknown): Response => {
  if (isAuthError(error)) {
    return createAuthErrorResponse(error.message);
  }
  if (isCsrfError(error)) {
    return Response.json({ error: "CSRF token required" }, { status: 403 });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
};
```

### 11. **Type Assertions Instead of Validation**
**Location:** `src/api/auth.ts:42-43`, `src/api/auth.ts:209`

**Issue:** Type assertions (`as`) used without runtime validation:
```typescript
email: (body as { email: string; password: string }).email, // ❌ Unsafe
const userData = user as NonNullable<typeof user>; // ❌ Type assertion
```

**Recommendation:** Use proper type guards or validation:
```typescript
const isAuthBody = (body: unknown): body is { email: string; password: string } => {
  return (
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    "password" in body &&
    typeof body.email === "string" &&
    typeof body.password === "string"
  );
};
```

### 12. **Excessive Console Logging**
**Location:** 63 instances across codebase

**Issue:** Debug logs left in production code. Should use proper logging library with levels.

**Recommendation:** 
- Remove or gate behind `NODE_ENV === "development"`
- Use structured logging library (e.g., `pino`, `winston`)
- Never log sensitive data

### 13. **No Request Size Limits**
**Location:** All API handlers

**Issue:** No validation of request body size, could allow DoS via large payloads.

**Recommendation:** Add middleware to limit request size:
```typescript
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
if (req.headers.get("content-length") && 
    Number.parseInt(req.headers.get("content-length")!) > MAX_BODY_SIZE) {
  return Response.json({ error: "Request too large" }, { status: 413 });
}
```

## 🔵 Performance Issues

### 14. **No Pagination for Entries**
**Location:** `src/api/entries.ts`

**Issue:** All entries loaded at once. With many entries, this will:
- Slow down initial load
- Consume excessive memory
- Cause poor UX

**Recommendation:** Implement pagination:
```typescript
export const handleEntriesGet = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  // ... fetch paginated entries
};
```

### 15. **localStorage Operations Not Batched**
**Location:** `src/lib/local-storage.ts`

**Issue:** Multiple localStorage reads/writes could be batched for better performance.

**Recommendation:** Batch operations where possible:
```typescript
export const batchUpdateEntries = (updates: Entry[]) =>
  Effect.sync(() => {
    const current = getLocalEntries();
    // Single write instead of multiple
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(merged));
  });
```

### 16. **No Request Caching**
**Location:** `src/app/app/api.ts`

**Issue:** Projects and entries fetched on every page load, even if unchanged.

**Recommendation:** Implement client-side caching with ETags or timestamps.

## 🟢 Architecture Concerns

### 17. **Tight Coupling**
**Location:** `src/app/app/app.ts`

**Issue:** App initialization tightly coupled to DOM elements and routing.

**Recommendation:** Extract initialization logic into smaller, testable functions.

### 18. **Race Conditions in Sync Logic**
**Location:** `src/app/app/sync.ts:20-35`

**Issue:** Timer sync logic could have race conditions if:
- Multiple tabs open
- Network reconnects during sync
- User actions during sync

**Recommendation:** Add synchronization locks or use WebSocket for coordination.

### 19. **No Validation for Entry Duration Limits**
**Location:** `src/app/app/api.ts:192`, `src/api/entries.ts:24-60`

**Issue:** No checks for:
- Negative durations
- Extremely large durations (e.g., 1000+ hours)
- Future dates

**Recommendation:** Add validation:
```typescript
const validateDuration = (startedAt: string, endedAt: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const now = new Date();
    const maxDuration = 24 * 30; // 30 days in hours
    
    if (start > now || end > now) {
      yield* Effect.fail(new Error("Cannot create entries in the future"));
    }
    
    const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (duration < 0) {
      yield* Effect.fail(new Error("End time must be after start time"));
    }
    if (duration > maxDuration) {
      yield* Effect.fail(new Error(`Duration cannot exceed ${maxDuration} hours`));
    }
  });
```

### 20. **Missing Error Boundaries**
**Location:** Frontend code

**Issue:** Unhandled Effect errors could crash the app.

**Recommendation:** Add error boundaries and global error handlers:
```typescript
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  // Show user-friendly error message
});
```

## 📋 Summary of Recommendations

### Immediate Actions (Security)
1. ✅ Remove or sanitize all console.log statements with sensitive data
2. ✅ Add input validation for project names
3. ✅ Implement rate limiting for all API endpoints
4. ✅ Fix CSRF token race condition
5. ✅ Add user status checks in WebSocket auth

### Short-term (Code Quality)
1. ✅ Replace `Effect.runSync` with proper Effect chains
2. ✅ Standardize error handling patterns
3. ✅ Replace type assertions with validation
4. ✅ Add request size limits
5. ✅ Implement proper logging system

### Medium-term (Performance)
1. ✅ Add pagination for entries
2. ✅ Implement client-side caching
3. ✅ Batch localStorage operations

### Long-term (Architecture)
1. ✅ Refactor sync logic to prevent race conditions
2. ✅ Add duration validation
3. ✅ Improve error boundaries
4. ✅ Reduce coupling

## 🎓 Educational Notes

### Why These Issues Matter

1. **Security**: Exposed tokens can lead to account takeover. Rate limiting prevents abuse. Input validation prevents injection attacks.

2. **Code Quality**: Consistent patterns make code maintainable. Proper error handling prevents crashes. Type safety catches bugs early.

3. **Performance**: Pagination prevents memory issues. Caching reduces server load. Batching reduces I/O operations.

4. **Architecture**: Loose coupling makes testing easier. Race condition prevention ensures data integrity. Error boundaries improve UX.

### Best Practices Demonstrated

✅ **Good**: Using Effect for functional error handling
✅ **Good**: CSRF protection implementation
✅ **Good**: Rate limiting on auth endpoints
✅ **Good**: Password validation
✅ **Good**: JWT with proper signature verification
✅ **Good**: Constant-time comparison for tokens

### Areas for Improvement

❌ **Needs Work**: Logging sensitive data
❌ **Needs Work**: Mixing sync/async patterns
❌ **Needs Work**: Missing input validation
❌ **Needs Work**: No rate limiting on non-auth endpoints
❌ **Needs Work**: Race conditions in sync logic

