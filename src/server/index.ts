import type { ServerWebSocket } from "bun";
import { Effect } from "effect";
import landing from "~/app/index.html";
import login from "~/app/login/login.html";
import { Redis, RedisLive } from "~/lib/redis";
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
        const tokenExp = ws.data?.tokenExp;
        console.log("WebSocket opened for user:", userId);

        if (userId === "hmr") {
          // HMR WebSocket - subscribe to HMR channel
          ws.subscribe("hmr");
          console.log("HMR WebSocket connected");
        } else if (userId && tokenExp) {
          // Regular WebSocket - subscribe to user-specific channels
          ws.subscribe(`user:${userId}:timer:updates`);

          // Set up token expiration check (check every 5 minutes)
          const checkInterval = setInterval(
            () => {
              const now = Math.floor(Date.now() / 1000);
              const timeUntilExpiry = tokenExp - now;

              // If token expires in less than 1 hour, warn client
              if (timeUntilExpiry > 0 && timeUntilExpiry < 3600) {
                try {
                  ws.send(
                    JSON.stringify({
                      type: "auth:token-expiring",
                      data: { expiresAt: tokenExp },
                    })
                  );
                } catch (error) {
                  console.error(
                    "Failed to send token expiration warning:",
                    error
                  );
                  clearInterval(checkInterval);
                }
              }

              // If token has expired, notify client and close connection
              if (timeUntilExpiry <= 0) {
                try {
                  ws.send(
                    JSON.stringify({
                      type: "auth:token-expired",
                      data: {},
                    })
                  );
                  ws.close(1008, "Token expired");
                } catch (error) {
                  console.error("Failed to send token expired message:", error);
                }
                clearInterval(checkInterval);
              }
            },
            5 * 60 * 1000
          ); // Check every 5 minutes

          // Store interval ID for cleanup
          (
            ws as unknown as { _tokenCheckInterval?: NodeJS.Timeout }
          )._tokenCheckInterval = checkInterval;
        }
      },
      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        // Handle token refresh requests from client
        try {
          const data = JSON.parse(
            typeof message === "string" ? message : message.toString()
          );

          if (data.type === "auth:refresh-token-request") {
            // Client is requesting a token refresh
            // Note: Actual token refresh should be done via HTTP endpoint
            // This is just an acknowledgment
            ws.send(
              JSON.stringify({
                type: "auth:refresh-token-required",
                data: {
                  message:
                    "Please refresh your token via /api/auth/refresh-token endpoint",
                },
              })
            );
          }
        } catch (error) {
          // Ignore malformed messages
          console.error("Failed to parse WebSocket message:", error);
        }
      },
      close(ws: ServerWebSocket<WebSocketData>) {
        // Cleanup token check interval
        const interval = (
          ws as unknown as { _tokenCheckInterval?: NodeJS.Timeout }
        )._tokenCheckInterval;
        if (interval) {
          clearInterval(interval);
        }
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

  // Initialize file watcher for HMR (development only)
  // Double-check to ensure watcher doesn't run in production
  // Check NODE_ENV, BUN_ENV, and if we're running from dist/ (production build)
  const nodeEnv = process.env.NODE_ENV;
  const bunEnv = process.env["BUN_ENV"];
  const isDistBuild = import.meta.dir.includes("/dist/");
  const isProduction =
    nodeEnv === "production" || bunEnv === "production" || isDistBuild;

  if (!isProduction) {
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
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          // Acquire Redis service - server won't start if Redis is unavailable
          yield* Redis;
          yield* Effect.log("✅ Redis connection verified");

          // Then start the server
          yield* serverResource;
          yield* Effect.log("✅ Server started successfully");

          // Keep the server running
          yield* Effect.never;
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
