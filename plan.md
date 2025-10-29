# Time Tracking Web App - Pure Bun + Effect

## Stack Overview

### Server

- **Runtime**: Bun.serve (native routing, WebSocket, pub/sub, static files)
- **Patterns**: Effect-TS for functional patterns, error handling, dependency injection
- **Database**: Bun's native Redis client (connects to hosted Redis for production)
- **Deployment**: Vercel with Bun runtime + hosted Redis (Upstash/Redis Labs)

### Client

- **Language**: Vanilla TypeScript
- **Bundler**: bun build (native, multiple entry points, watch mode)
- **Reactivity**: Two approaches (Branch A and B below)
- **Real-time**: WebSocket with Bun's native pub/sub
- **Dev reload**: Custom live-reload script (~10 lines)

### Dependencies

```json
{
  "dependencies": {
    "effect": "latest"
  }
}
```

That's it! Everything else is Bun built-in.

## Architecture

### Routing Structure

```
/                     → Static landing page (HTML)
/app                  → Time tracking SPA (HTML shell)
/api/projects         → REST API (GET/POST)
/api/entries          → REST API (GET/POST)
/api/entries/:id      → REST API (GET/PATCH/DELETE)
/api/timer/start      → Start timer
/api/timer/stop       → Stop timer
/ws                   → WebSocket for real-time sync
```

### Data Models (Bun Redis)

```typescript
// Single-user for now (userId = "default")
// Keys structure (standard Redis)
project:{projectId}           → hash of project data
entry:{entryId}               → hash of entry data
active:timer                  → hash of active timer state
projects:list                 → set of project IDs
entries:{date}                → sorted set of entry IDs by timestamp

// Real-time via Bun WebSocket pub/sub (in-memory)
// Topics for WebSocket broadcasts
"timer:update"                → Timer state changes
"entry:created"               → New entry added
"project:created"             → New project added
```

### Database Strategy

- **Local dev**: Redis running locally (`redis://localhost:6379`)
- **Production**: Hosted Redis service (Upstash, Redis Labs, etc.)
- **Client**: Bun's native `redis` from 'bun' package (zero dependencies)

## Client-Side Reactivity (Two Branches)

### Branch A: DIY Reactive System

Build from scratch using Proxies:

```typescript
// Core primitives (~100 lines)
signal(value)           // Reactive primitive
computed(() => expr)    // Derived state  
effect(() => { ... })   // Side effects
// Auto-tracking dependencies
```

### Branch B: Simple Store Pattern

Minimal approach with manual updates:

```typescript
// Simple pattern (~30 lines)
createStore(initialState)   // Returns Proxy
store.subscribe(callback)   // Listen to changes
// Explicit render() calls
```

Both approaches: <5KB total bundle impact.

## Build & Dev Strategy

### Development

```bash
# Terminal 1: Server with hot reload
bun --hot src/server/index.ts

# Terminal 2: Client watcher (auto-rebuild)
bun build src/client/app/main.ts \
  --outdir=dist/public/assets \
  --entry-naming=[name].[hash].js \
  --watch

# Terminal 3 (optional): Local Redis
redis-server

# Or use a single dev script that runs all 3
```

### Client Live Reload

Add tiny WebSocket script to dev HTML that reloads on rebuild:

```typescript
// dev-reload.ts (~10 lines)
// Watches dist/public/assets, sends reload signal
// Client reconnects WebSocket, reloads page
```

### Production Build

```bash
bun run build
# Builds:
# 1. Client bundles with bun build (minified, hashed)
# 2. Server entry point
# 3. Copies HTML templates

dist/
├── server.js              # Server entry
├── public/
│   ├── index.html         # Landing page
│   ├── app.html           # App shell
│   └── assets/
│       ├── landing.[hash].js   # <10KB
│       └── app.[hash].js       # <50KB
```

## Implementation Steps

1. **Project Setup**

   - Run `bun init`
   - Install only: `effect`
   - Configure tsconfig.json (strict mode, ESM)
   - Create folder structure

2. **Local Redis Setup**

   - Install Redis locally (brew/apt/docker)
   - Test connection with `bun:redis`
   - Set REDIS_URL env var

3. **Server Foundation**

   - Set up Bun.serve with routes
   - Static file serving for `/` and `/app`
   - Basic API routes structure
   - Effect Context setup

4. **Database Layer**

   - Bun Redis client as Effect Layer
   - Define Redis key patterns
   - Project service (CRUD with Effect)
   - Entry service (CRUD with Effect)
   - Timer service (start/stop/get active)

5. **WebSocket Real-time**

   - WebSocket upgrade in Bun.serve
   - Subscribe clients to topics on connect
   - Publish timer updates to all clients
   - Handle reconnection on client

6. **Client Build Setup**

   - Create build script using `bun build`
   - Multiple entry points (landing + app)
   - HTML templates with script injection
   - Dev live-reload script

7. **Choose Reactive Approach**

   - **Branch A**: Implement signal/computed/effect primitives
   - **Branch B**: Implement simple store with subscriptions
   - Decision point: choose one to proceed

8. **Timer Store & UI**

   - Client-side timer state store
   - WebSocket client connection
   - Timer controls (start/stop/pause)
   - Real-time display with tick updates
   - Project selector

9. **Projects & Entries UI**

   - Project list component
   - Create project form
   - Entry list with date filter
   - Entry display (duration, project, date)

10. **Landing Page**

    - Static HTML with minimal JS
    - Feature overview
    - Link to /app
    - <10KB total

11. **Production Build Script**

    - Build client with minification
    - Generate hash filenames
    - Inject script tags into HTML
    - Output to dist/

12. **Vercel Deployment**

    - Create vercel.json (Bun runtime)
    - Set REDIS_URL env var (Upstash/Redis Labs URL)
    - Build command configuration
    - Test deployment

## File Structure

```
time-space/
├── src/
│   ├── server/
│   │   ├── index.ts              # Bun.serve entry
│   │   ├── routes.ts             # Route definitions
│   │   ├── websocket.ts          # WS handlers
│   │   └── services/
│   │       ├── redis.ts          # Bun Redis Effect Layer
│   │       ├── projects.ts       # Project service
│   │       ├── entries.ts        # Entry service
│   │       └── timer.ts          # Timer service
│   ├── client/
│   │   ├── landing/
│   │   │   └── main.ts           # Landing page entry
│   │   ├── app/
│   │   │   ├── main.ts           # App entry
│   │   │   ├── reactive/         # Branch A or B
│   │   │   │   └── [impl].ts
│   │   │   ├── store/
│   │   │   │   └── timer.ts      # Timer state
│   │   │   ├── components/
│   │   │   │   ├── timer.ts
│   │   │   │   ├── projects.ts
│   │   │   │   └── entries.ts
│   │   │   └── ws.ts             # WebSocket client
│   │   └── shared/
│   │       └── api.ts            # API client helpers
│   └── shared/
│       ├── types.ts              # Shared types
│       └── constants.ts          # Shared constants
├── public/
│   ├── index.html                # Landing template
│   └── app.html                  # App template
├── scripts/
│   ├── build.ts                  # Production build script
│   └── dev-reload.ts             # Dev live-reload
├── tsconfig.json
├── package.json
└── vercel.json
```

## Key Implementation Details

### Bun Redis with Effect

```typescript
import { redis } from 'bun'
import { Effect, Layer } from 'effect'

class RedisService extends Effect.Service<RedisService>()('Redis', {
  effect: Effect.gen(function*(_) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'
    // Bun's redis is a singleton, connects automatically
    return { redis }
  })
}) {}

// Usage in services
const getProjects = Effect.gen(function*(_) {
  const { redis } = yield* _(RedisService)
  const ids = await redis.smembers('projects:list')
  return ids
})
```

### bun build for Client

```typescript
// scripts/build.ts
await Bun.build({
  entrypoints: [
    'src/client/landing/main.ts',
    'src/client/app/main.ts'
  ],
  outdir: 'dist/public/assets',
  naming: '[name].[hash].[ext]',
  minify: true,
  splitting: true,
  target: 'browser',
  sourcemap: 'external'
})
```

### Dev Live Reload (~10 lines)

```typescript
// Client side in dev mode
if (import.meta.env.DEV) {
  new WebSocket('ws://localhost:3001/dev-reload')
    .addEventListener('message', () => location.reload())
}

// Server side: watch dist/public/assets, broadcast changes
```

### Bun.serve with Routes

```typescript
Bun.serve({
  routes: {
    '/': new Response(Bun.file('dist/public/index.html')),
    '/app': new Response(Bun.file('dist/public/app.html')),
    '/api/projects': {
      GET: () => getProjects(),
      POST: async (req) => createProject(await req.json())
    },
  },
  websocket: {
    open(ws) { ws.subscribe('timer:update') },
    message(ws, msg) { handleMessage(ws, msg) }
  }
})
```

## Bundle Size Targets

- Landing JS: <10KB gzipped
- App JS: <50KB gzipped (including reactivity)
- First load: <100KB total
- **Zero external frontend dependencies**

## Learning Outcomes

- Deep understanding of HTTP/WebSocket protocols
- Reactive programming patterns from scratch
- Effect-TS functional patterns
- Bun's native capabilities (Redis, build, serve, WebSocket)
- Modern bundling strategies
- Vanilla TypeScript DOM manipulation
- Real-time sync strategies
- Zero-dependency frontend architecture

## Environment Variables

```bash
# Local development
REDIS_URL=redis://localhost:6379

# Production (Vercel)
REDIS_URL=redis://default:password@upstash-redis.com:6379
# Or use Upstash REST API if needed
```

## Future Enhancements (Not in Scope)

- Multi-user with authentication
- macOS/iOS apps (same WebSocket protocol)
- Data export/reports
- Project budgets/billing
- Team features
- Redis Sentinel/Cluster for HA