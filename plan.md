# Time Tracking Web App - Pure Bun + Effect

## Stack Overview

### Server

- **Runtime**: Bun.serve (native routing, WebSocket, pub/sub, static files)
- **Patterns**: Effect-TS for functional patterns, error handling, dependency injection
- **Database**: Bun's native Redis client (connects to hosted Redis for production)
- **Deployment**: Vercel with Bun runtime + hosted Redis (Upstash/Redis Labs)

### Client

- **Language**: Vanilla TypeScript
- **Bundler**: Bun HTML imports (auto-transpile, auto-bundle, built-in HMR)
- **Reactivity**: Two approaches (Branch A and B below)
- **Real-time**: WebSocket with Bun's native pub/sub
- **Dev reload**: Built-in HMR (no custom code needed)

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
/                     → SSR landing page (instant load, no JS needed)
/app                  → SPA with HTML imports (client-side only)
/dashboard            → [Optional] Streaming SSR with suspense pattern
/api/projects         → REST API (GET/POST)
/api/entries          → REST API (GET/POST)
/api/entries/:id      → REST API (GET/PATCH/DELETE)
/api/timer/start      → Start timer
/api/timer/stop       → Stop timer
/ws                   → WebSocket for real-time sync
```

**Rendering Strategy:**
- Landing `/`: Pure SSR (no hydration, just HTML)
- App `/app`: Pure CSR (client-side rendering with HMR)
- Dashboard `/dashboard`: Streaming SSR (optional learning exercise)

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

### Development (Single Command!)

```bash
# One command starts everything with HMR
bun --hot src/server/index.ts

# Bun automatically:
# - Starts HTTP server
# - Enables server hot reload
# - Transpiles & bundles client code on-demand
# - Provides client-side HMR
# - No build step needed!

# Optional: Run Redis in another terminal
redis-server
```

### How HTML Imports Work

Bun serves HTML files that reference TypeScript/JSX directly:

```html
<!-- public/app.html -->
<script type="module" src="../client/app/main.ts"></script>
```

Bun automatically:
- Transpiles TypeScript/JSX to JavaScript
- Bundles dependencies
- Provides HMR for instant updates
- Handles CSS imports
- No config needed!

### Production Build (Optional)

For production optimization, use `bun build`:

```bash
bun build src/server/index.ts --compile --outfile=server

# Or deploy source directly to Vercel
# Vercel will run: bun src/server/index.ts
```

Bun HTML imports work in production too - files are bundled on first request and cached.

## Server-Side Rendering (SSR) Strategy

### Three Rendering Approaches

#### 1. Pure SSR (Landing Page)
Simplest approach - render complete HTML on server, no client JS needed:

```typescript
Bun.serve({
  routes: {
    '/': async () => {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <body>
          <h1>Time Tracker</h1>
          <a href="/app">Get Started</a>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      })
    }
  }
})
```

**Use for:** Static marketing pages, landing pages
**Pros:** Instant load, SEO-friendly, no JS needed
**Cons:** No interactivity without client JS

#### 2. Streaming SSR with Suspense Pattern
Send HTML shell immediately, stream data as it arrives:

```typescript
'/dashboard': async () => {
  const stream = new ReadableStream({
    async start(controller) {
      // 1. Send shell immediately (instant visual response)
      controller.enqueue(`
        <!DOCTYPE html>
        <html>
        <body>
          <div id="projects">
            <div class="loading">⏳ Loading projects...</div>
          </div>
          <div id="entries">
            <div class="loading">⏳ Loading entries...</div>
          </div>
      `)
      
      // 2. Fetch data in parallel (non-blocking)
      const [projects, entries] = await Promise.all([
        getProjectsFromRedis(),
        getEntriesFromRedis()
      ])
      
      // 3. Stream updates as data arrives
      controller.enqueue(`
          <script>
            document.querySelector('#projects .loading').outerHTML = \`
              <ul>${projects.map(p => `<li>${p.name}</li>`).join('')}</ul>
            \`;
          </script>
      `)
      
      controller.enqueue(`
          <script>
            document.querySelector('#entries .loading').outerHTML = \`
              <div class="entries">${renderEntries(entries)}</div>
            \`;
          </script>
        </body>
        </html>
      `)
      
      controller.close()
    }
  })
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}
```

**Use for:** Dashboard with multiple data sources
**Pros:** Instant shell, progressive enhancement, handles slow queries
**Cons:** More complex, requires careful error handling

#### 3. Out-of-Order Streaming (Advanced)
Stream data in any order as it becomes available (React 18-style):

```typescript
'/dashboard': async () => {
  const stream = new ReadableStream({
    async start(controller) {
      // Send shell with placeholder templates
      controller.enqueue(`
        <!DOCTYPE html>
        <html>
        <body>
          <template id="suspense-0"></template>
          <template id="suspense-1"></template>
          <template id="suspense-2"></template>
          <script>
            function hydrate(id, html) {
              const t = document.getElementById('suspense-' + id)
              const div = document.createElement('div')
              div.innerHTML = html
              t.replaceWith(...div.childNodes)
            }
          </script>
      `)
      
      // Fire off multiple queries - don't await!
      let completed = 0
      const total = 3
      
      getProjects().then(data => {
        controller.enqueue(`
          <script>hydrate(0, \`<div>Projects: ${renderProjects(data)}</div>\`)</script>
        `)
        if (++completed === total) controller.close()
      })
      
      getEntries().then(data => {
        controller.enqueue(`
          <script>hydrate(1, \`<div>Entries: ${renderEntries(data)}</div>\`)</script>
        `)
        if (++completed === total) controller.close()
      })
      
      getStats().then(data => {
        controller.enqueue(`
          <script>hydrate(2, \`<div>Stats: ${renderStats(data)}</div>\`)</script>
        `)
        if (++completed === total) controller.close()
      })
    }
  })
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}
```

**Use for:** Multiple independent data sources with varying latency
**Pros:** Optimal TTFB, displays fast data first
**Cons:** Most complex, tricky error handling

### Hybrid: SSR + Client Hydration

SSR initial content, then hydrate for interactivity:

```typescript
'/dashboard': async () => {
  const projects = await getProjects()
  return new Response(`
    <!DOCTYPE html>
    <html>
    <body>
      <div id="app" data-projects='${JSON.stringify(projects)}'>
        ${renderProjects(projects)}
      </div>
      <script type="module" src="../client/dashboard/main.ts"></script>
    </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  })
}
```

Client hydrates the SSR'd content:

```typescript
// src/client/dashboard/main.ts
const app = document.getElementById('app')
const initialProjects = JSON.parse(app.dataset.projects || '[]')

// Attach event listeners, make interactive
const store = createStore({ projects: initialProjects })
attachEventListeners(app, store)
```

**Use for:** Interactive dashboards with initial data
**Pros:** Best of both worlds, SEO + interactivity
**Cons:** Careful state management needed

### Recommendation for Time Tracker

1. **Landing `/`** - Pure SSR (no JS)
2. **App `/app`** - Pure CSR with HTML imports (real-time features)
3. **Dashboard `/dashboard`** - Optional: Streaming SSR experiment

This gives you three different patterns to learn and compare!

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

3. **HTML Templates**

   - Create `public/index.html` (landing page)
   - Create `public/app.html` (app shell)
   - Add `<script type="module" src="../client/...">` tags
   - Bun will handle transpilation automatically

4. **Server Foundation with HTML Imports**

   - Import HTML files: `import app from "./public/app.html"`
   - Set up Bun.serve with routes
   - Serve HTML imports with built-in HMR
   - Basic API routes structure
   - Effect Context setup

5. **Database Layer**

   - Bun Redis client as Effect Layer
   - Define Redis key patterns
   - Project service (CRUD with Effect)
   - Entry service (CRUD with Effect)
   - Timer service (start/stop/get active)

6. **WebSocket Real-time**

   - WebSocket upgrade in Bun.serve
   - Subscribe clients to topics on connect
   - Publish timer updates to all clients
   - Handle reconnection on client

7. **Choose Reactive Approach**

   - **Branch A**: Implement signal/computed/effect primitives
   - **Branch B**: Implement simple store with subscriptions
   - Decision point: choose one to proceed

8. **Client Reactivity Implementation**

   - Implement chosen reactive system
   - Create timer store with chosen approach
   - Test HMR with client changes

9. **Timer UI**

   - Timer controls (start/stop/pause)
   - Real-time display with tick updates
   - WebSocket client connection
   - Project selector

10. **Projects & Entries UI**

    - Project list component
    - Create project form
    - Entry list with date filter
    - Entry display (duration, project, date)

11. **Landing Page (Pure SSR)**

    - Server-rendered HTML (no client JS)
    - Feature overview, benefits, CTA
    - Link to /app
    - <5KB total (just HTML + minimal CSS)

12. **[Optional] Streaming SSR Dashboard**

    - Create `/dashboard` route with streaming
    - Implement suspense-like pattern
    - Show projects/entries with loading states
    - Compare performance with SPA

13. **[Optional] SSR + Hydration Experiment**

    - Try hybrid SSR + client hydration
    - Pre-render dashboard, hydrate for interactivity
    - Compare bundle sizes and TTFB

14. **Vercel Deployment**

    - Create vercel.json (Bun runtime)
    - Set REDIS_URL env var (Upstash/Redis Labs URL)
    - Deploy source directly (no build needed!)
    - Test production

## File Structure

```
time-space/
├── src/
│   ├── server/
│   │   ├── index.ts              # Bun.serve entry (imports HTML files)
│   │   ├── routes.ts             # Route definitions
│   │   ├── websocket.ts          # WS handlers
│   │   ├── ssr/                  # [Optional] SSR utilities
│   │   │   ├── render.ts         # HTML rendering helpers
│   │   │   ├── stream.ts         # Streaming SSR utilities
│   │   │   └── components.ts     # Server-side components
│   │   └── services/
│   │       ├── redis.ts          # Bun Redis Effect Layer
│   │       ├── projects.ts       # Project service
│   │       ├── entries.ts        # Entry service
│   │       └── timer.ts          # Timer service
│   ├── client/
│   │   ├── landing/
│   │   │   └── main.ts           # Landing page entry (minimal)
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
│   │   ├── dashboard/            # [Optional] For SSR hydration
│   │   │   └── main.ts           # Hydration entry
│   │   └── shared/
│   │       └── api.ts            # API client helpers
│   └── shared/
│       ├── types.ts              # Shared types
│       ├── constants.ts          # Shared constants
│       └── components/           # [Optional] Isomorphic components
│           └── ProjectCard.ts    # Shared between SSR and CSR
├── public/
│   ├── app.html                  # App (imports ../client/app/main.ts)
│   └── styles.css                # [Optional] Shared styles
├── tsconfig.json
├── package.json
└── vercel.json
```

**Note**: No `scripts/` or `dist/` folders needed! Bun handles everything.
**SSR files** are optional - add them if you want to experiment with streaming SSR.

## Key Implementation Details

### Server with HTML Imports

```typescript
// src/server/index.ts
import landing from "../public/index.html"
import app from "../public/app.html"

Bun.serve({
  routes: {
    '/': landing,                    // Bun auto-bundles referenced scripts!
    '/app': app,                     // With HMR in dev mode
    '/api/projects': {
      GET: () => getProjects(),
      POST: async (req) => createProject(await req.json())
    },
  },
  websocket: {
    open(ws) { ws.subscribe('timer:update') },
    message(ws, msg) { handleMessage(ws, msg) }
  },
  development: {
    hmr: true,        // Built-in HMR for client code!
    console: true,    // Show console logs
  }
})
```

### HTML Template with TypeScript Import

```html
<!-- public/app.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Time Tracker</title>
</head>
<body>
  <div id="app"></div>
  
  <!-- Bun auto-transpiles and bundles this TypeScript file! -->
  <script type="module" src="../client/app/main.ts"></script>
</body>
</html>
```

### Bun Redis with Effect

```typescript
// src/server/services/redis.ts
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

### Client Entry Point

```typescript
// src/client/app/main.ts
import { createStore } from './reactive/store'
import { Timer } from './components/timer'
import { ProjectList } from './components/projects'

// Your vanilla TS code - Bun handles the rest!
const store = createStore({ /* ... */ })

// Bun's HMR will update this automatically on save
console.log('App loaded with HMR!')
```

### Pure SSR Landing Page

```typescript
// src/server/routes.ts
export const landing = async () => {
  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Time Tracker - Track Your Time Effortlessly</title>
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
        .cta { background: #000; color: #fff; padding: 1rem 2rem; text-decoration: none; }
      </style>
    </head>
    <body>
      <h1>⏱️ Time Tracker</h1>
      <p>Track your time across projects with real-time sync.</p>
      <a href="/app" class="cta">Get Started</a>
    </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}
```

### Streaming SSR Dashboard (Optional)

```typescript
// src/server/ssr/stream.ts
export async function streamDashboard() {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (html: string) => controller.enqueue(encoder.encode(html))
      
      // 1. Send shell immediately
      send(`
        <!DOCTYPE html>
        <html>
        <head><title>Dashboard</title></head>
        <body>
          <h1>Dashboard</h1>
          <div id="projects" class="loading">⏳ Loading projects...</div>
          <div id="stats" class="loading">⏳ Loading stats...</div>
      `)
      
      // 2. Fetch data
      const [projects, stats] = await Promise.all([
        getProjects(),
        getStats()
      ])
      
      // 3. Stream updates
      send(`
        <script>
          document.getElementById('projects').outerHTML = \`
            <div id="projects">
              <h2>Projects</h2>
              <ul>${projects.map(p => `<li>${p.name}</li>`).join('')}</ul>
            </div>
          \`;
        </script>
      `)
      
      send(`
        <script>
          document.getElementById('stats').outerHTML = \`
            <div id="stats">
              <p>Total: ${stats.total} hours</p>
            </div>
          \`;
        </script>
        </body>
        </html>
      `)
      
      controller.close()
    }
  })
  
  return new Response(stream, {
    headers: { 
      'Content-Type': 'text/html; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  })
}
```

### Shared Rendering Utilities (Optional)

```typescript
// src/shared/components/ProjectCard.ts
export function renderProjectCard(project: Project): string {
  return `
    <div class="project-card">
      <h3>${escapeHtml(project.name)}</h3>
      <p>${project.totalTime}h tracked</p>
    </div>
  `
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Use in SSR:
// const html = projects.map(renderProjectCard).join('')

// Use in CSR:
// const html = renderProjectCard(project)
// element.innerHTML = html
```

## Bundle Size Targets

- **Landing** (`/`): ~3-5KB total (pure SSR, no JS)
- **App** (`/app`): <50KB gzipped (including reactivity)
- **Dashboard** (optional SSR): ~20KB initial + streaming data
- First load: <100KB total
- **Zero external frontend dependencies**

**Performance Targets:**
- Landing TTFB: <100ms (SSR)
- App interactive: <500ms (CSR + HMR)
- Dashboard FCP: <200ms (streaming SSR)

## Learning Outcomes

### Core Web Technologies
- Deep understanding of HTTP/WebSocket protocols
- Streaming responses and chunked transfer encoding
- Server-Side Rendering (SSR) fundamentals
- Client-Side Rendering (CSR) vs SSR tradeoffs
- Progressive enhancement patterns

### Reactive Programming
- Reactive programming patterns from scratch
- Signal/computed/effect primitives
- State management without libraries
- Real-time sync strategies

### Bun Ecosystem
- Bun's native capabilities (Redis, serve, WebSocket, HTML imports, HMR)
- How modern frameworks work under the hood
- Understanding transpilation and bundling without config
- Zero-config development experience

### Advanced Patterns
- Streaming SSR with suspense-like patterns
- Out-of-order streaming (React 18-style)
- SSR + client hydration
- Isomorphic/universal rendering
- Effect-TS functional patterns

### Engineering Practices
- Vanilla TypeScript DOM manipulation
- Zero-dependency frontend architecture
- Performance optimization (TTFB, FCP, TTI)
- Web vitals understanding

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