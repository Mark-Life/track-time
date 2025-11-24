# Track Time

Time tracking web app built with Bun, Effect-TS, and Redis.

## Stack

- **Runtime**: Bun (server + bundler)
- **Patterns**: Effect-TS (functional, error handling, DI)
- **Database**: Redis (Bun native client)
- **Frontend**: Vanilla TypeScript (no frameworks)
- **Deployment**: Vercel (Bun runtime)

## Features

- **Authentication**: User registration, login, logout with JWT tokens
- **Projects**: Create, edit, delete projects; assign to time entries
- **Timer**: Start/stop timer with live elapsed time display; assign project while running
- **Time Entries**: Create, edit, delete entries; filter by date; view duration and project
- **Calendar View**: Visual timeline with hourly breakdown; drag to create entries; click to edit; navigate days with current time indicator
- **Real-time Sync**: Multi-tab synchronization via WebSocket; timer updates broadcast instantly
- **Offline Support**: Local storage caching; sync when connection restored
- **Date Navigation**: Filter entries by specific date; view daily time totals

## Setup

```bash
# Install dependencies
bun install

# Set environment variables
REDIS_URL=redis://localhost:6379

# Run development server
bun run dev
```

## Scripts

- `bun run dev` - Start dev server with HMR
- `bun run build` - Build for production
- `bun run start` - Run production build
- `bun run check` - Type check and lint
- `bun run fix` - Auto-fix linting issues

## Project Structure

```
src/
├── api/              # API route handlers
├── app/              # Frontend (HTML + TypeScript)
│   ├── app/          # Main app SPA
│   └── login/        # Login page
├── lib/              # Shared libraries
│   ├── auth/         # Authentication (JWT, CSRF, middleware)
│   └── redis/        # Redis service layer
└── server/           # Server entry point and routing
```

## Environment Variables

- `REDIS_URL` - Redis connection URL (required)
- `NODE_ENV` - `production` or development (default)

## Deployment

Deploy to Vercel with Bun runtime. Set `REDIS_URL` environment variable.
