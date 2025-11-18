import {
  APP_PATH_REGEX,
  APP_TILDE_PATH_REGEX,
  LEADING_SLASH_REGEX,
  TILDE_PATH_REGEX,
} from "./utils.ts";

// Resolve to src/ directory (parent of server/)
const SRC_DIR = `${import.meta.dir}/..`;

const bundleTailwindCSS = async (): Promise<Response> => {
  try {
    // Create a temporary CSS file that imports tailwindcss
    const tempDir = `${SRC_DIR}/.tmp`;
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
      outdir: `${SRC_DIR}/.tmp`,
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
  const resolvedPath = `${SRC_DIR}/${filePath}`;
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
      outdir: `${SRC_DIR}/.tmp`,
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
    resolvedPath = `${SRC_DIR}/app/app/${filePath}`;
  } else {
    // Try /app.ts (root level - likely from HTML served at /app)
    const fileName = pathname.replace(LEADING_SLASH_REGEX, "");
    if (fileName === "app.ts" || fileName === "app.js") {
      resolvedPath = `${SRC_DIR}/app/app/app.ts`;
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

export const handleAssets = async (pathname: string): Promise<Response | null> => {
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

