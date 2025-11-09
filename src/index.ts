import app from "~/app/app/index.html";
import landing from "~/app/index.html";
import {
  getActiveTimer,
  getEntries,
  startTimer,
  stopTimer,
} from "./lib/redis.ts";
import type { WebSocketMessage } from "./lib/types.ts";

const server = Bun.serve({
  port: 3000,

  routes: {
    // HTML routes
    "/": landing,
    "/app": app,

    // API routes
    "/api/timer": {
      async GET() {
        const timer = await getActiveTimer();
        return Response.json(timer);
      },
    },

    "/api/timer/start": {
      async POST() {
        const timer = await startTimer();

        // Broadcast to all WebSocket clients
        const message: WebSocketMessage = {
          type: "timer:started",
          data: { startedAt: timer.startedAt },
        };
        server.publish("timer:updates", JSON.stringify(message));

        return Response.json(timer);
      },
    },

    "/api/timer/stop": {
      async POST() {
        const entry = await stopTimer();
        if (!entry) {
          return Response.json({ error: "No active timer" }, { status: 400 });
        }

        // Broadcast to all WebSocket clients
        const message: WebSocketMessage = {
          type: "timer:stopped",
          data: { entry },
        };
        server.publish("timer:updates", JSON.stringify(message));

        return Response.json(entry);
      },
    },

    "/api/entries": {
      async GET() {
        const entries = await getEntries();
        return Response.json(entries);
      },
    },
  },

  fetch(req, srv) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req);
      if (upgraded) {
        return;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Return undefined to let routes handle other requests
    return;
  },

  websocket: {
    open(ws) {
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

console.log(`🚀 Server running at ${server.url}`);
