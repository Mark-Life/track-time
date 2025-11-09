# ToDo - Time Tracker App

## 🔴 Critical Fixes

### Error Handling

- [ ] Add proper error handling in API routes - many `.catch()` blocks only log errors but don't return proper error responses
- [ ] Add error handling for WebSocket message parsing failures (currently just logs, should notify user)
- [ ] Add error handling for Redis connection failures in all operations
- [ ] Add error handling for localStorage operations (quota exceeded, etc.)
- [ ] Add error handling for fetch failures in client API calls
- [ ] Add proper error boundaries for Effect operations that might fail
- [ ] Add user-friendly error messages instead of just console.error
- [ ] Add error handling for WebSocket reconnection failures
- [ ] Add error handling for invalid date formats in entry forms
- [ ] Add error handling for project name validation failures

### Bugs

- [ ] **No pagination on time entries** - all entries loaded at once, will be slow with many entries
- [ ] WebSocket doesn't reconnect automatically on disconnect
- [ ] No loading states when fetching data (entries, projects, timer)
- [ ] Race conditions possible when syncing offline timer with server
- [ ] No validation for entry duration limits (negative, too large, etc.)
- [ ] No handling for concurrent timer starts (multiple tabs/devices)
- [ ] Missing error handling in `handleApiRequest` when route handlers return null
- [ ] No cleanup for WebSocket connections when navigating between pages
- [ ] `biome-ignore` comment in app.ts for excessive cognitive complexity - needs refactoring

## 🟡 Features

### Authentication & Multi-User Support

- [ ] **Authentication system** - currently app works for all users, needs user accounts
- [ ] User registration/login (email/password, OAuth, or magic links)
- [ ] Session management (JWT tokens or cookies)
- [ ] User-specific data isolation in Redis (prefix keys with userId)
- [ ] Protected API routes (require authentication)
- [ ] Protected WebSocket connections (authenticate on connect)
- [ ] User profile management
- [ ] Password reset functionality
- [ ] Account deletion
- [ ] Multi-device session management
- [ ] Remember me / persistent sessions

### Reports & Analytics

- [ ] **Reports view/page** - dedicated page for viewing and analyzing entries
- [ ] **Download entries** - export filtered entries to CSV/JSON
- [ ] Time tracking statistics dashboard
- [ ] Visual charts/graphs (hours per day, per project, trends)
- [ ] Filter by date range, project, custom criteria
- [ ] Summary statistics (total hours, average per day, top projects)
- [ ] Export reports as PDF
- [ ] Scheduled reports (email weekly/monthly summaries)
- [ ] Compare time periods (this week vs last week, etc.)
- [ ] Project time breakdown
- [ ] Daily/weekly/monthly summaries

### Offline Support

- [ ] **Service Worker** for offline work (cache static assets, API responses)
- [ ] Background sync when coming back online
- [ ] Queue failed API requests for retry when online
- [ ] Cache projects locally for offline access
- [ ] Show sync status indicator (syncing, synced, error)
- [ ] Handle conflicts when syncing offline changes

### Build System

- [ ] **Build script to generate static HTML** from TypeScript functions (as mentioned in plan.md)
- [ ] Replace inline SVG icons with imports in HTML templates
- [ ] Pre-render static content at build time
- [ ] Optimize HTML imports for production
- [ ] Generate static landing page HTML at build time

### Entries Management

- [ ] **Pagination for time entries** (load 20-50 at a time)
- [ ] Date filtering (today, this week, this month, custom range)
- [ ] Search/filter entries by project
- [ ] Sort entries by date, duration, project
- [ ] Bulk delete entries
- [ ] Entry statistics (total hours, by project, by date range)
- [ ] Note: Export functionality moved to Reports section

### UI/UX Improvements

- [ ] Loading skeletons/spinners for async operations
- [ ] Toast notifications for success/error messages
- [ ] Confirmation dialogs for destructive actions (delete entry, delete project)
- [ ] Keyboard shortcuts (space to start/stop timer, etc.)
- [ ] Better mobile responsiveness
- [ ] Dark/light theme toggle
- [ ] Entry duration formatting (show hours and minutes, not just decimal hours)
- [ ] Better date/time display formatting
- [ ] Empty states with helpful messages

### Performance

- [ ] Virtual scrolling for entries list (if many entries)
- [ ] Debounce search/filter inputs
- [ ] Lazy load project combobox options
- [ ] Optimize WebSocket message handling
- [ ] Cache API responses with appropriate TTL
- [ ] Optimize Redis queries (batch operations where possible)

### Data Management

- [ ] Data import
- [ ] Backup/restore functionality
- [ ] Data migration utilities
- [ ] Cleanup old entries (archive/delete after X days)
- [ ] Note: Export functionality moved to Reports section

## 🟢 Improvements

### Code Quality

- [ ] Refactor WebSocket message handler in app.ts (reduce cognitive complexity)
- [ ] Extract common error handling patterns into utilities
- [ ] Add more comprehensive TypeScript types
- [ ] Add JSDoc comments for public APIs
- [ ] Extract validation logic into shared utilities
- [ ] Create error types hierarchy (NetworkError, ValidationError, etc.)
- [ ] Add unit tests for critical functions
- [ ] Add integration tests for API routes

### Architecture

- [ ] Create shared error handling utilities
- [ ] Extract WebSocket client into separate module
- [ ] Create API client wrapper with retry logic
- [ ] Add request/response logging middleware
- [ ] Create validation schemas (Zod?) for API requests
- [ ] Add rate limiting for API routes
- [ ] Add request ID tracking for debugging

### Type Safety

- [ ] Add stricter types for WebSocket messages
- [ ] Add runtime validation for API request/response types
- [ ] Add type guards for localStorage data
- [ ] Add branded types for IDs (EntryId, ProjectId, etc.)

### Security

- [ ] **Authentication required** - protect all routes and API endpoints
- [ ] Add input sanitization for user-generated content
- [ ] Add CSRF protection for API routes
- [ ] Add rate limiting per IP/user
- [ ] Validate all user inputs on server side
- [ ] Add content security policy headers
- [ ] Secure password storage (hashing, salting)
- [ ] Protect against SQL injection (if using SQL later)
- [ ] Session security (httpOnly cookies, secure flags)
- [ ] Rate limiting for authentication endpoints

### Developer Experience

- [ ] Add development tools (React DevTools-like for state inspection)
- [ ] Add logging levels (debug, info, warn, error)
- [ ] Add performance monitoring
- [ ] Add error tracking (Sentry-like)
- [ ] Better build error messages

### Documentation

- [ ] Add README with setup instructions
- [ ] Document API endpoints
- [ ] Document WebSocket message protocol
- [ ] Add architecture documentation
- [ ] Document offline sync strategy
- [ ] Add deployment guide

## 📝 Notes from plan.md

### Still Relevant

- [ ] Static HTML files served with no build step - need build script to generate HTML from TS functions
- [ ] SVG icons are passed as strings instead of imported - should use icon functions
- [ ] Static text in HTML should be TypeScript functions for build-time generation
- [ ] Need proper build script for production optimization

### Already Implemented

- ✅ HTML imports working (Bun auto-transpiles)
- ✅ WebSocket real-time sync
- ✅ Offline support with localStorage
- ✅ Effect-TS for functional patterns
- ✅ Bun Redis client
- ✅ Client-side routing

## 🔄 Refactoring Opportunities

- [ ] Split large files (app.ts is 675 lines, dom.ts could be split)
- [ ] Extract entry rendering logic into separate component
- [ ] Extract project management logic into separate module
- [ ] Create shared utilities for date formatting
- [ ] Create shared utilities for API error handling
- [ ] Extract WebSocket connection logic into reusable module
- [ ] Create shared types file for DOM element references

## 🎯 Priority Order (Suggested)

1. **Critical**: Pagination for entries, WebSocket reconnection, error handling improvements
2. **High**: **Authentication system** (required before multi-user), Service Worker, build script for HTML generation, loading states
3. **Medium**: Reports view, date filtering, UI improvements
4. **Low**: Theme toggle, keyboard shortcuts, advanced features
