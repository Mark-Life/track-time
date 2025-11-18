import { Effect } from "effect";
import { handleApiRequest } from "../api/index.ts";
import { extractToken } from "../lib/auth/auth.ts";
import { verify } from "../lib/auth/jwt.ts";
import {
  compose,
  requireAuth,
  requireAuthForAssets,
} from "../lib/auth/middleware.ts";
import type { Server, WebSocketData } from "./types.ts";
import { createRedirectResponse } from "./utils.ts";

const runAuthMiddleware = async (req: Request): Promise<Response | null> => {
  const middlewareChain = compose(requireAuthForAssets, requireAuth);
  return await Effect.runPromise(
    Effect.catchAll(middlewareChain(req), () =>
      Effect.succeed(createRedirectResponse("/login"))
    )
  );
};

export const handleApiRoutes = async (
  pathname: string,
  req: Request,
  srv: Server
): Promise<Response | null> => {
  if (!pathname.startsWith("/api")) {
    return null;
  }

  const apiResponse = await handleApiRequest(req, srv);
  if (apiResponse) {
    return apiResponse;
  }

  return Response.json({ error: "Not Found" }, { status: 404 });
};

export const handleAppRoutes = async (
  pathname: string
): Promise<Response | null> => {
  if (!pathname.startsWith("/app")) {
    return null;
  }

  // Don't serve HTML for asset requests
  if (
    pathname.endsWith(".ts") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname === "/app/tailwindcss" ||
    pathname.startsWith("/app/~/")
  ) {
    return null;
  }

  // Resolve to src/ directory (parent of server/)
  const SRC_DIR = `${import.meta.dir}/..`;
  const appHtmlFile = Bun.file(`${SRC_DIR}/app/app/index.html`);
  const appHtml = await appHtmlFile.text();

  return new Response(appHtml, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};

export const handleWebSocketUpgrade = async (
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

export { runAuthMiddleware };
