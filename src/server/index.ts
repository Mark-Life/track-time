import type { ServerWebSocket } from "bun";
import { Effect } from "effect";
import landing from "~/app/index.html";
import login from "~/app/login/login.html";
import { redisResource } from "../lib/redis.ts";
import { handleAssets } from "./assets.ts";
import {
  handleApiRoutes,
  handleAppRoutes,
  handleWebSocketUpgrade,
  runAuthMiddleware,
} from "./routes.ts";
import type { Server, WebSocketData } from "./types.ts";

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
      const url = new URL(req.url);
      const pathname = url.pathname;

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
    },

    error(error: Error): Response {
      console.error("Server error:", error);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    },

    websocket: {
      open(ws: ServerWebSocket<WebSocketData>) {
        const userId = ws.data?.userId;
        console.log("WebSocket opened for user:", userId);
        if (userId) {
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

  return serverInstance;
});

const serverResource = Effect.acquireRelease(createServer, (server) =>
  Effect.sync(() => {
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
