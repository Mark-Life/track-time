import type { ServerWebSocket } from "bun";
import { Effect } from "effect";
import landing from "~/app/index.html";
import login from "~/app/login/login.html";
import { handleApiRequest } from "./api/index.ts";
import { extractToken } from "./lib/auth.ts";
import { verify } from "./lib/jwt.ts";
import {
  compose,
  requireAuth,
  requireAuthForAssets,
} from "./lib/middleware.ts";
import { redisResource } from "./lib/redis.ts";

type Server = ReturnType<typeof Bun.serve>;
type WebSocketData = { userId: string };

// Regex patterns for path matching (defined at top level for performance)
const APP_TILDE_PATH_REGEX = /^\/app\/~/;
const TILDE_PATH_REGEX = /^\/~/;
const APP_PATH_REGEX = /^\/app\//;
const LEADING_SLASH_REGEX = /^\//;

const createRedirectResponse = (location: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
    },
  });

const runAuthMiddleware = async (req: Request): Promise<Response | null> => {
  const middlewareChain = compose(requireAuthForAssets, requireAuth);
  return await Effect.runPromise(
    Effect.catchAll(middlewareChain(req), () =>
      Effect.succeed(createRedirectResponse("/login"))
    )
  );
};

const handleApiRoutes = async (
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

const bundleTailwindCSS = async (): Promise<Response> => {
  try {
    // Create a temporary CSS file that imports tailwindcss
    const tempDir = `${import.meta.dir}/.tmp`;
    const tempCssPath = `${tempDir}/tailwind-temp.css`;
    await Bun.write(tempCssPath, `@import "tailwindcss";`);

    // Use Bun's bundler with tailwind plugin
    const tailwindPlugin = await import("bun-plugin-tailwind");
    const bundled = await Bun.build({
      entrypoints: [tempCssPath],
      plugins: [tailwindPlugin.default || tailwindPlugin],
      outdir: tempDir,
      target: "bun",
    });

    if (bundled.success && bundled.outputs && bundled.outputs.length > 0) {
      const output = bundled.outputs[0];
      if (output) {
        const css = await output.text();
        return new Response(css, {
          headers: {
            "Content-Type": "text/css",
          },
        });
      }
    }
  } catch (error) {
    console.error("Failed to bundle tailwindcss:", error);
  }

  // Fallback: return CSS import statement
  return new Response(`@import "tailwindcss";`, {
    headers: {
      "Content-Type": "text/css",
    },
  });
};

const bundleCSSFile = async (cssPath: string): Promise<Response | null> => {
  try {
    const tailwindPlugin = await import("bun-plugin-tailwind");
    const bundled = await Bun.build({
      entrypoints: [cssPath],
      plugins: [tailwindPlugin.default || tailwindPlugin],
      outdir: `${import.meta.dir}/.tmp`,
      target: "bun",
    });

    if (bundled.success && bundled.outputs && bundled.outputs.length > 0) {
      const output = bundled.outputs[0];
      if (output) {
        const css = await output.text();
        return new Response(css, {
          headers: {
            "Content-Type": "text/css",
          },
        });
      }
    }
  } catch (error) {
    console.error("Failed to bundle CSS:", error);
  }
  return null;
};

const handleTildePath = async (pathname: string): Promise<Response | null> => {
  const isTildePath =
    APP_TILDE_PATH_REGEX.test(pathname) || TILDE_PATH_REGEX.test(pathname);
  if (!isTildePath) {
    return null;
  }

  const filePath = pathname
    .replace(APP_TILDE_PATH_REGEX, "")
    .replace(TILDE_PATH_REGEX, "");
  const resolvedPath = `${import.meta.dir}/${filePath}`;
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    return null;
  }

  // For CSS files, process imports (like @import "tailwindcss")
  if (filePath.endsWith(".css")) {
    const bundled = await bundleCSSFile(resolvedPath);
    if (bundled) {
      return bundled;
    }
  }

  // Serve the file directly for non-CSS or if bundling failed
  return new Response(file, {
    headers: {
      "Content-Type": filePath.endsWith(".css")
        ? "text/css"
        : "application/javascript",
    },
  });
};

const bundleTSFile = async (tsPath: string): Promise<Response | null> => {
  try {
    const bundled = await Bun.build({
      entrypoints: [tsPath],
      outdir: `${import.meta.dir}/.tmp`,
      target: "browser",
      format: "esm",
      sourcemap: "inline",
    });

    if (bundled.success && bundled.outputs && bundled.outputs.length > 0) {
      const output = bundled.outputs[0];
      if (output) {
        const js = await output.text();
        return new Response(js, {
          headers: {
            "Content-Type": "application/javascript",
          },
        });
      }
    }
  } catch (error) {
    console.error("Failed to bundle TypeScript:", error);
  }
  return null;
};

const handleTSJSFiles = async (pathname: string): Promise<Response | null> => {
  const isTSJS = pathname.endsWith(".ts") || pathname.endsWith(".js");
  if (!isTSJS) {
    return null;
  }

  let resolvedPath: string | null = null;

  // Try /app/app.ts first (if path starts with /app/)
  if (APP_PATH_REGEX.test(pathname)) {
    const filePath = pathname.replace(APP_PATH_REGEX, "");
    resolvedPath = `${import.meta.dir}/app/app/${filePath}`;
  } else {
    // Try /app.ts (root level - likely from HTML served at /app)
    const fileName = pathname.replace(LEADING_SLASH_REGEX, "");
    if (fileName === "app.ts" || fileName === "app.js") {
      resolvedPath = `${import.meta.dir}/app/app/app.ts`;
    }
  }

  if (!resolvedPath) {
    return null;
  }

  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    return null;
  }

  // For TypeScript files, use Bun's bundler to transpile and resolve imports
  if (resolvedPath.endsWith(".ts")) {
    const bundled = await bundleTSFile(resolvedPath);
    if (bundled) {
      return bundled;
    }
    // Fallback to raw file if bundling fails
  }

  // For JavaScript files, serve directly
  return new Response(file, {
    headers: {
      "Content-Type": "application/javascript",
    },
  });
};

const handleAssets = async (pathname: string): Promise<Response | null> => {
  // Handle tailwindcss - use Bun's bundler to process it
  // Handle both /tailwindcss and /~/tailwindcss (for CSS imports)
  if (
    pathname === "/tailwindcss" ||
    pathname === "/app/tailwindcss" ||
    pathname === "/~/tailwindcss"
  ) {
    return await bundleTailwindCSS();
  }

  // Handle ~/ paths (like ~/global.css)
  const tildeResponse = await handleTildePath(pathname);
  if (tildeResponse) {
    return tildeResponse;
  }

  // Handle .ts and .js files
  const tsjsResponse = await handleTSJSFiles(pathname);
  if (tsjsResponse) {
    return tsjsResponse;
  }

  return null;
};

const handleAppRoutes = async (pathname: string): Promise<Response | null> => {
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

  const appHtmlFile = Bun.file(`${import.meta.dir}/app/app/index.html`);
  const appHtml = await appHtmlFile.text();

  return new Response(appHtml, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};

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
