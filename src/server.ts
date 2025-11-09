import { Effect } from "effect";
import app from "~/app/app/index.html";
import landing from "~/app/index.html";
import {
  deleteEntry,
  getActiveTimer,
  getEntries,
  redisResource,
  startTimer,
  stopTimer,
  updateEntry,
} from "./lib/redis.ts";
import type { WebSocketMessage } from "./lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

const ENTRIES_ID_REGEX = /^\/api\/entries\/(.+)$/;

const createServer = Effect.gen(function* () {
  let serverInstance: Server | null = null;

  const createServerConfig = () => ({
    port: 3000,

    routes: {
      // HTML routes
      "/": landing,
      "/app": app,

      // API routes
      "/api/timer": {
        async GET() {
          const timer = await Effect.runPromise(getActiveTimer());
          return Response.json(timer);
        },
      },

      "/api/timer/start": {
        POST(req: Request) {
          return Effect.runPromise(
            Effect.gen(function* () {
              let body: { startedAt?: string } | undefined;
              try {
                body = yield* Effect.tryPromise({
                  try: () => req.json() as Promise<{ startedAt?: string }>,
                  catch: () => new Error("Failed to parse body"),
                });
              } catch {
                // No body provided, use current time
                body = undefined;
              }

              // Validate startedAt if provided
              if (body?.startedAt) {
                const date = new Date(body.startedAt);
                if (Number.isNaN(date.getTime())) {
                  return Response.json(
                    { error: "Invalid startedAt format. Expected ISO string." },
                    { status: 400 }
                  );
                }
              }

              const timer = yield* startTimer(body?.startedAt);

              // Broadcast to all WebSocket clients
              const message: WebSocketMessage = {
                type: "timer:started",
                data: { startedAt: timer.startedAt },
              };
              serverInstance?.publish("timer:updates", JSON.stringify(message));

              return Response.json(timer);
            })
          ).catch((error) =>
            Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to start timer",
              },
              { status: 500 }
            )
          );
        },
      },

      "/api/timer/stop": {
        async POST() {
          const entry = await Effect.runPromise(stopTimer());
          if (!entry) {
            return Response.json({ error: "No active timer" }, { status: 400 });
          }

          // Broadcast to all WebSocket clients
          const message: WebSocketMessage = {
            type: "timer:stopped",
            data: { entry },
          };
          serverInstance?.publish("timer:updates", JSON.stringify(message));

          return Response.json(entry);
        },
      },

      "/api/entries": {
        async GET() {
          const entries = await Effect.runPromise(getEntries());
          return Response.json(entries);
        },
      },
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO fix me later
    fetch(req: Request, srv: Server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const upgraded = srv.upgrade(req, { data: undefined });
        if (upgraded) {
          return new Response("WebSocket upgraded", { status: 200 });
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // DELETE /api/entries/:id
      // PUT /api/entries/:id
      const entriesMatch = url.pathname.match(ENTRIES_ID_REGEX);
      if (entriesMatch) {
        const id = entriesMatch[1];
        if (!id) {
          return new Response("Not Found", { status: 404 });
        }

        if (req.method === "DELETE") {
          return Effect.runPromise(
            Effect.gen(function* () {
              yield* deleteEntry(id);

              // Broadcast to all WebSocket clients
              const message: WebSocketMessage = {
                type: "entry:deleted",
                data: { id },
              };
              serverInstance?.publish("timer:updates", JSON.stringify(message));

              return Response.json({ success: true });
            })
          ).catch((error) =>
            Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to delete entry",
              },
              { status: 500 }
            )
          );
        }

        if (req.method === "PUT") {
          return Effect.runPromise(
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO fix me later
            Effect.gen(function* () {
              const body: { startedAt: string; endedAt: string } =
                yield* Effect.tryPromise({
                  try: () =>
                    req.json() as Promise<{
                      startedAt: string;
                      endedAt: string;
                    }>,
                  catch: (error) =>
                    new Error(`Failed to parse request body: ${error}`),
                });

              if (!(body.startedAt && body.endedAt)) {
                return Response.json(
                  { error: "startedAt and endedAt are required" },
                  { status: 400 }
                );
              }

              // Validate date formats
              const startedAtDate = new Date(body.startedAt);
              const endedAtDate = new Date(body.endedAt);

              if (Number.isNaN(startedAtDate.getTime())) {
                return Response.json(
                  { error: "Invalid startedAt format. Expected ISO string." },
                  { status: 400 }
                );
              }

              if (Number.isNaN(endedAtDate.getTime())) {
                return Response.json(
                  { error: "Invalid endedAt format. Expected ISO string." },
                  { status: 400 }
                );
              }

              // Validate end time is after start time
              if (endedAtDate.getTime() <= startedAtDate.getTime()) {
                return Response.json(
                  { error: "End time must be after start time" },
                  { status: 400 }
                );
              }

              const entry = yield* updateEntry(
                id,
                body.startedAt,
                body.endedAt
              );

              // Broadcast to all WebSocket clients
              const message: WebSocketMessage = {
                type: "entry:updated",
                data: { entry },
              };
              serverInstance?.publish("timer:updates", JSON.stringify(message));

              return Response.json(entry);
            })
          ).catch((error) =>
            Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to update entry",
              },
              { status: 500 }
            )
          );
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
