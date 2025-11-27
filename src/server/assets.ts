import { join } from "node:path";
import {
  APP_PATH_REGEX,
  APP_TILDE_PATH_REGEX,
  LEADING_SLASH_REGEX,
  LOGIN_TILDE_PATH_REGEX,
  TILDE_PATH_REGEX,
} from "./utils";
import { trackDependencies } from "./watcher";

// Resolve to src/ directory
// In development: import.meta.dir ends with /server or /server/, so go up one level
// In production (bundled): import.meta.dir is dist/src/, so use it directly
const SRC_DIR =
  import.meta.dir.includes("/server") || import.meta.dir.endsWith("server")
    ? join(import.meta.dir, "..")
    : import.meta.dir;

const bundleTailwindCSS = async (): Promise<Response> => {
  try {
    // Create a temporary CSS file that imports tailwindcss
    const tempDir = join(SRC_DIR, ".tmp");
    const tempCssPath = join(tempDir, "tailwind-temp.css");
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
    // Track dependencies for HMR (development only)
    if (process.env.NODE_ENV !== "production") {
      await trackDependencies(cssPath);
    }

    const tailwindPlugin = await import("bun-plugin-tailwind");
    const bundled = await Bun.build({
      entrypoints: [cssPath],
      plugins: [tailwindPlugin.default || tailwindPlugin],
      outdir: join(SRC_DIR, ".tmp"),
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
    APP_TILDE_PATH_REGEX.test(pathname) ||
    LOGIN_TILDE_PATH_REGEX.test(pathname) ||
    TILDE_PATH_REGEX.test(pathname);
  if (!isTildePath) {
    return null;
  }

  const filePath = pathname
    .replace(APP_TILDE_PATH_REGEX, "")
    .replace(LOGIN_TILDE_PATH_REGEX, "")
    .replace(TILDE_PATH_REGEX, "");
  const resolvedPath = join(SRC_DIR, filePath);
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
  const getContentType = (path: string): string => {
    if (path.endsWith(".css")) {
      return "text/css";
    }
    if (path.endsWith(".svg")) {
      return "image/svg+xml";
    }
    if (path.endsWith(".png")) {
      return "image/png";
    }
    if (path.endsWith(".json")) {
      return "application/json";
    }
    if (path.endsWith(".js")) {
      return "application/javascript";
    }
    if (path.endsWith(".ts")) {
      return "application/javascript";
    }
    return "application/octet-stream";
  };

  return new Response(file, {
    headers: {
      "Content-Type": getContentType(filePath),
    },
  });
};

const bundleTSFile = async (tsPath: string): Promise<Response | null> => {
  try {
    // Track dependencies for HMR (development only)
    if (process.env.NODE_ENV !== "production") {
      await trackDependencies(tsPath);
    }

    const bundled = await Bun.build({
      entrypoints: [tsPath],
      outdir: join(SRC_DIR, ".tmp"),
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
    resolvedPath = join(SRC_DIR, "app", "app", filePath);
  } else {
    // Try /app.ts (root level - likely from HTML served at /app)
    const fileName = pathname.replace(LEADING_SLASH_REGEX, "");
    if (fileName === "app.ts" || fileName === "app.js") {
      resolvedPath = join(SRC_DIR, "app", "app", "app.ts");
    } else if (fileName === "login.ts" || fileName === "login.js") {
      // Handle /login.ts (from login.html served at /login)
      resolvedPath = join(SRC_DIR, "app", "login", "login.ts");
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

const handleRootStaticFiles = async (
  pathname: string
): Promise<Response | null> => {
  // Handle root-level static files that browsers look for
  if (pathname === "/manifest.json") {
    const manifestPath = join(SRC_DIR, "assets", "manifest.json");
    const file = Bun.file(manifestPath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
    const faviconPath = join(SRC_DIR, "assets", "favicon.svg");
    const file = Bun.file(faviconPath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": "image/svg+xml",
        },
      });
    }
  }

  // Handle apple-touch-icon.png (iOS home screen icon)
  if (pathname === "/apple-touch-icon.png") {
    const iconPath = join(SRC_DIR, "assets", "apple-touch-icon.png");
    const file = Bun.file(iconPath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }
  }

  return null;
};

export const handleAssets = async (
  pathname: string
): Promise<Response | null> => {
  // Handle root-level static files first (manifest.json, favicon)
  const rootStaticResponse = await handleRootStaticFiles(pathname);
  if (rootStaticResponse) {
    return rootStaticResponse;
  }

  // Handle tailwindcss - use Bun's bundler to process it
  // Handle both /tailwindcss and /~/tailwindcss (for CSS imports)
  // Also handle relative paths from /login and /app routes
  if (
    pathname === "/tailwindcss" ||
    pathname === "/app/tailwindcss" ||
    pathname === "/login/tailwindcss" ||
    pathname === "/~/tailwindcss" ||
    pathname === "/app/~/tailwindcss" ||
    pathname === "/login/~/tailwindcss"
  ) {
    return await bundleTailwindCSS();
  }

  // Handle ~/ paths (like ~/global.css)
  // Also handle relative paths from /login and /app routes
  // When HTML is at /login, ~/global.css resolves to /login/~/global.css
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
