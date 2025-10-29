import app from "../../public/app.html";
// Import HTML files
import landing from "../../public/index.html";
import type { WebSocketMessage } from "../shared/types.ts";
import { getActiveTimer, getEntries, startTimer, stopTimer } from "./redis.ts";

const server = Bun.serve({
  port: 3000,

  routes: {
    "/": landing,
    "/app": app,
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // API: Get active timer
    if (url.pathname === "/api/timer" && req.method === "GET") {
      const timer = await getActiveTimer();
      return Response.json(timer);
    }

    // API: Start timer
    if (url.pathname === "/api/timer/start" && req.method === "POST") {
      const timer = await startTimer();

      // Broadcast to all WebSocket clients
      const message: WebSocketMessage = {
        type: "timer:started",
        data: { startedAt: timer.startedAt },
      };
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json(timer);
    }

    // API: Stop timer
    if (url.pathname === "/api/timer/stop" && req.method === "POST") {
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
    }

    // API: Get all entries
    if (url.pathname === "/api/entries" && req.method === "GET") {
      const entries = await getEntries();
      return Response.json(entries);
    }

    // Return undefined to let routes handle other requests
    return;
  },

  websocket: {
    open(ws) {
      // Subscribe to timer updates
      ws.subscribe("timer:updates");
    },
    message(ws, msg) {
      // Client messages (not used for now)
    },
    close(ws) {
      // Cleanup if needed
    },
  },

  development: true,
});

console.log(`Server running at ${server.url}`);
