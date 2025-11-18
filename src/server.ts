import type { ServerWebSocket } from "bun";
import { Effect } from "effect";
import app from "~/app/app/index.html";
import landing from "~/app/index.html";
import login from "~/app/login/login.html";
import { handleApiRequest } from "./api/index.ts";
import { extractToken } from "./lib/auth.ts";
import { verify } from "./lib/jwt.ts";
import { redisResource } from "./lib/redis.ts";

type Server = ReturnType<typeof Bun.serve>;
type WebSocketData = { userId: string };

const handleWebSocketUpgrade = async (
  req: Request,
  srv: Server
): Promise<Response> => {
  try {
    const token = await Effect.runPromise(extractToken(req));
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = await Effect.runPromise(verify(token));
    const upgraded = srv.upgrade(req, {
      data: { userId: payload.userId } as WebSocketData,
    });

    if (upgraded) {
      return new Response("WebSocket upgraded", { status: 200 });
    }
    return new Response("WebSocket upgrade failed", { status: 400 });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
};

const createServer = Effect.gen(function* () {
  const createServerConfig = () => ({
    port: 3000,

    routes: {
      // Public HTML routes
      "/": landing,
      "/login": login,

      // protected app route
      "/app": app,
      "/app/projects": app,
    },

    async fetch(req: Request, srv: Server) {
      const url = new URL(req.url);
      // WebSocket upgrade (must be in fetch, not routes)
      if (url.pathname === "/ws") {
        return handleWebSocketUpgrade(req, srv);
      }

      // API routes (need server instance for WebSocket publishing)
      if (url.pathname.startsWith("/api")) {
        const apiResponse = await handleApiRequest(req, srv);
        if (apiResponse) {
          return apiResponse;
        }

        // No handler matched
        return Response.json({ error: "Not Found" }, { status: 404 });
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
