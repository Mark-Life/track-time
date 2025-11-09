import { Effect } from "effect";
import app from "~/app/app/index.html";
import landing from "~/app/index.html";
import { handleApiRequest } from "./api/index.ts";
import { redisResource } from "./lib/redis.ts";

type Server = ReturnType<typeof Bun.serve>;

const createServer = Effect.gen(function* () {
  let serverInstance: Server | null = null;

  const createServerConfig = () => ({
    port: 3000,

    routes: {
      // HTML routes
      "/": landing,
      "/app": app,
      "/projects": app, // SPA route - serves same HTML as /app
    },

    async fetch(req: Request, srv: Server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const upgraded = srv.upgrade(req, { data: undefined });
        if (upgraded) {
          return new Response("WebSocket upgraded", { status: 200 });
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // API routes
      if (url.pathname.startsWith("/api")) {
        const apiResponse = await handleApiRequest(req, srv);
        if (apiResponse) {
          return apiResponse;
        }
      }

      // Return undefined to let routes handle other requests
      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      open(ws: { subscribe: (channel: string) => void }) {
        ws.subscribe("timer:updates");
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

  serverInstance = Bun.serve(createServerConfig());
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
