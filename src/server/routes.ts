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
  const url = new URL(req.url);
  const pathname = url.pathname;

  return await Effect.runPromise(
    Effect.catchAll(middlewareChain(req), () => {
      // If middleware threw an error, default based on route type
      if (pathname.startsWith("/api")) {
        return Effect.succeed(
          Response.json({ error: "Unauthorized" }, { status: 401 })
        );
      }
      return Effect.succeed(createRedirectResponse("/login"));
    })
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
  let appHtml = await appHtmlFile.text();

  // Inject HMR client code in development
  if (process.env.NODE_ENV !== "production") {
    const hmrScript = `
    <script>
      (function() {
        if (typeof window === 'undefined') return;
        
        let ws;
        let reconnectTimeout;
        
        const connectHMR = () => {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          ws = new WebSocket(protocol + '//' + window.location.host + '/hmr');
          
          ws.onopen = () => {
            console.log('[HMR] Connected');
            if (reconnectTimeout) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = null;
            }
          };
          
          ws.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              if (message.type === 'hmr-update') {
                console.log('[HMR] File changed:', message.file);
                
                // Reload CSS files
                if (message.file.endsWith('.css')) {
                  const links = document.querySelectorAll('link[rel="stylesheet"]');
                  links.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href) {
                      const newHref = href.split('?')[0] + '?t=' + Date.now();
                      link.setAttribute('href', newHref);
                    }
                  });
                } else {
                  // Reload page for JS/TS/HTML changes
                  window.location.reload();
                }
              }
            } catch (e) {
              // Ignore non-JSON messages
            }
          };
          
          ws.onerror = (error) => {
            console.error('[HMR] WebSocket error:', error);
          };
          
          ws.onclose = () => {
            console.log('[HMR] Disconnected, reconnecting...');
            // Reconnect after 1 second
            reconnectTimeout = setTimeout(() => {
              connectHMR();
            }, 1000);
          };
        };
        
        connectHMR();
      })();
    </script>`;

    // Inject before closing </body> tag
    appHtml = appHtml.replace("</body>", `${hmrScript}</body>`);
  }

  return new Response(appHtml, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};

export const handleHMRWebSocketUpgrade = (
  req: Request,
  srv: Server
): Response => {
  // HMR WebSocket doesn't require auth (development only)
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const upgraded = srv.upgrade(req, {
    data: { userId: "hmr" } as WebSocketData,
  });

  if (upgraded) {
    return new Response("HMR WebSocket upgraded", { status: 200 });
  }
  return new Response("HMR WebSocket upgrade failed", { status: 400 });
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
