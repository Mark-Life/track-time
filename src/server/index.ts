import type { ServerWebSocket } from "bun";
import { Effect } from "effect";
import landing from "~/app/index.html";
import login from "~/app/login/login.html";
import { redisResource } from "../lib/redis.ts";
import { handleAssets } from "./assets.ts";
import {
  handleApiRoutes,
  handleAppRoutes,
  handleHMRWebSocketUpgrade,
  handleWebSocketUpgrade,
  runAuthMiddleware,
} from "./routes.ts";
import type { Server, WebSocketData } from "./types.ts";
import {
  cleanupWatcher,
  initializeWatcher,
  setServerInstance,
} from "./watcher.ts";

const handleRequest = async (req: Request, srv: Server): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // HMR WebSocket upgrade (development only, no auth required)
  if (pathname === "/hmr") {
    return handleHMRWebSocketUpgrade(req, srv);
  }

  // WebSocket upgrade (must be in fetch, not routes)
  if (pathname === "/ws") {
    return handleWebSocketUpgrade(req, srv);
  }

  // Run authentication middleware for protected routes and assets
  const middlewareResult = await runAuthMiddleware(req);
  if (middlewareResult !== null) {
    return middlewareResult;
  }

  // Handle assets (CSS, JS) - check before API routes
  const assetResponse = await handleAssets(pathname);
  if (assetResponse !== null) {
    return assetResponse;
  }

  // API routes (need server instance for WebSocket publishing)
  const apiResponse = await handleApiRoutes(pathname, req, srv);
  if (apiResponse !== null) {
    return apiResponse;
  }

  // Protected app routes - serve HTML if authenticated (middleware already checked)
  const appResponse = await handleAppRoutes(pathname);
  if (appResponse !== null) {
    return appResponse;
  }

  // Fallback for unmatched routes (routes are checked first, so this handles anything not matched)
  return new Response("Not Found", { status: 404 });
};

const createServer = Effect.gen(function* () {
  const createServerConfig = () => ({
    port: 3000,

    routes: {
      // Public HTML routes
      "/": landing,
      "/login": login,
      // Note: /app* routes are handled manually in fetch handler with auth middleware
    },
    async fetch(req: Request, srv: Server) {
      return await handleRequest(req, srv);
    },

    error(error: Error): Response {
      console.error("Server error:", error);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    },

    websocket: {
      open(ws: ServerWebSocket<WebSocketData>) {
        const userId = ws.data?.userId;
        console.log("WebSocket opened for user:", userId);

        if (userId === "hmr") {
          // HMR WebSocket - subscribe to HMR channel
          ws.subscribe("hmr");
          console.log("HMR WebSocket connected");
        } else if (userId) {
          // Regular WebSocket - subscribe to user-specific channels
          ws.subscribe(`user:${userId}:timer:updates`);
        }
      },
      message() {
        // Client messages (not used for now)
      },
      close() {
        // Cleanup if needed
      },
    },

    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });

  const serverInstance = Bun.serve<WebSocketData>(createServerConfig());
  yield* Effect.log(`🚀 Server running at ${serverInstance.url}`);

  // Set server instance for HMR updates
  setServerInstance(serverInstance);

  // Initialize file watcher for HMR
  if (process.env.NODE_ENV !== "production") {
    initializeWatcher();
  }

  return serverInstance;
});

const serverResource = Effect.acquireRelease(createServer, (server) =>
  Effect.sync(() => {
    cleanupWatcher();
    server.stop();
  })
);

export const startServer = async () =>
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // Acquire Redis connection first - server won't start if Redis is unavailable
        yield* redisResource;
        yield* Effect.log("✅ Redis connection verified");

        // Then start the server
        yield* serverResource;
        yield* Effect.log("✅ Server started successfully");

        // Keep the server running
        yield* Effect.never;
      })
    )
  ).catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
