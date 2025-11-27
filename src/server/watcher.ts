import { watch } from "node:fs";
import { join, relative } from "node:path";
import type { Server } from "./types";

// Resolve to src/ directory
// In development: import.meta.dir ends with /server or /server/, so go up one level
// In production (bundled): import.meta.dir is dist/src/, so use it directly
const SRC_DIR =
  import.meta.dir.includes("/server") || import.meta.dir.endsWith("server")
    ? join(import.meta.dir, "..")
    : import.meta.dir;

// Track watched files and their dependencies
const watchedFiles = new Set<string>();
const fileDependencies = new Map<string, Set<string>>(); // file -> set of dependencies
const watchers = new Map<string, ReturnType<typeof watch>>();

// Track server instance for sending HMR updates
let serverInstance: Server | null = null;

export const setServerInstance = (server: Server) => {
  serverInstance = server;
};

// Get all files that should be watched
const getFilesToWatch = (): string[] => {
  const files: string[] = [
    // HTML files
    join(SRC_DIR, "app", "app", "index.html"),
    join(SRC_DIR, "app", "index.html"),
    join(SRC_DIR, "app", "login", "login.html"),
    // Main TypeScript entry point
    join(SRC_DIR, "app", "app", "app.ts"),
    // CSS files
    join(SRC_DIR, "global.css"),
    // Common directories to watch
    join(SRC_DIR, "app", "app"),
    join(SRC_DIR, "components"),
    join(SRC_DIR, "lib"),
  ];
  return files;
};

// Resolve import path to absolute path
const resolveImportPath = (importPath: string, basePath: string): string => {
  if (importPath.startsWith("~/")) {
    return join(SRC_DIR, importPath.slice(2));
  }
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    return join(basePath, "..", importPath);
  }
  const isExternal =
    importPath.startsWith("http") || importPath.startsWith("/");
  if (!isExternal) {
    // Local module - try to resolve
    return join(basePath, "..", importPath);
  }
  return "";
};

// Extract JS/TS imports from content
const extractJSImports = (
  content: string,
  filePath: string,
  dependencies: Set<string>
): void => {
  const importRegex =
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?["']([^"']+)["']|import\s*\(["']([^"']+)["']\)/g;
  let match: RegExpExecArray | null = importRegex.exec(content);

  while (match !== null) {
    const importPath = match[1] || match[2];
    if (importPath) {
      const resolved = resolveImportPath(importPath, filePath);
      if (resolved) {
        dependencies.add(resolved);
      }
    }
    match = importRegex.exec(content);
  }
};

// Extract CSS imports from content
const extractCSSImports = (
  content: string,
  filePath: string,
  dependencies: Set<string>
): void => {
  const cssImportRegex = /@import\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null = cssImportRegex.exec(content);

  while (match !== null) {
    const importPath = match[1];
    if (importPath) {
      const resolved = resolveImportPath(importPath, filePath);
      if (resolved) {
        dependencies.add(resolved);
      }
    }
    match = cssImportRegex.exec(content);
  }
};

// Extract dependencies from a bundled file
const extractDependencies = async (filePath: string): Promise<string[]> => {
  const dependencies = new Set<string>();

  try {
    // Read the file to find imports
    const content = await Bun.file(filePath).text();

    // Extract JS/TS imports
    extractJSImports(content, filePath, dependencies);

    // Extract CSS imports
    extractCSSImports(content, filePath, dependencies);
  } catch (error) {
    console.error(`Failed to extract dependencies from ${filePath}:`, error);
  }

  return Array.from(dependencies);
};

// Send HMR update to all connected WebSocket clients
const sendHMRUpdate = (changedFile: string) => {
  if (!serverInstance) {
    return;
  }

  const relativePath = relative(SRC_DIR, changedFile);
  const update = JSON.stringify({
    type: "hmr-update",
    file: relativePath,
    timestamp: Date.now(),
  });

  // Send to all connected WebSocket clients
  serverInstance.publish("hmr", update);

  console.log(`🔄 HMR: File changed - ${relativePath}`);
};

// Watch a single file
const watchFile = (filePath: string) => {
  if (watchedFiles.has(filePath)) {
    return; // Already watching
  }

  try {
    const handleChange = (eventType: string) => {
      if (eventType === "change") {
        // File changed - send HMR update
        sendHMRUpdate(filePath);

        // If this file has dependencies, also check them
        const deps = fileDependencies.get(filePath);
        if (deps) {
          for (const dep of deps) {
            sendHMRUpdate(dep);
          }
        }
      }
    };

    const watcher = watch(filePath, { recursive: false }, handleChange);

    watchedFiles.add(filePath);
    watchers.set(filePath, watcher);
  } catch (error) {
    // File might not exist yet, or might be a directory
    console.warn(`Could not watch ${filePath}:`, error);
  }
};

// Watch a directory recursively
const watchDirectory = (dirPath: string) => {
  if (watchedFiles.has(dirPath)) {
    return; // Already watching
  }

  try {
    const handleChange = (eventType: string, filename: string | null) => {
      if (eventType === "change" && filename) {
        const fullPath = join(dirPath, filename);
        sendHMRUpdate(fullPath);
      }
    };

    const watcher = watch(dirPath, { recursive: true }, handleChange);

    watchedFiles.add(dirPath);
    watchers.set(dirPath, watcher);
  } catch (error) {
    console.warn(`Could not watch directory ${dirPath}:`, error);
  }
};

// Track dependencies when bundling a file
export const trackDependencies = async (filePath: string) => {
  // Don't track dependencies in production
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env["BUN_ENV"] === "production";
  if (isProduction) {
    return; // Skip dependency tracking in production
  }

  const deps = await extractDependencies(filePath);
  fileDependencies.set(filePath, new Set(deps));

  // Watch the file and its dependencies
  watchFile(filePath);
  for (const dep of deps) {
    const depFile = Bun.file(dep);
    if (await depFile.exists()) {
      watchFile(dep);
    }
  }
};

// Initialize file watching
export const initializeWatcher = () => {
  // Don't watch in production - check both NODE_ENV and explicit production flag
  // Also check if we're running from dist/ directory (production build)
  const nodeEnv = process.env.NODE_ENV;
  const bunEnv = process.env["BUN_ENV"];
  const isDistBuild = import.meta.dir.includes("/dist/");
  const isProduction =
    nodeEnv === "production" || bunEnv === "production" || isDistBuild;

  if (isProduction) {
    // Silently skip watcher initialization in production
    return;
  }

  // Only proceed if we're in development
  const filesToWatch = getFilesToWatch();

  for (const filePath of filesToWatch) {
    // Check if it's a file or directory
    Bun.file(filePath)
      .exists()
      .then((exists) => {
        if (exists) {
          // Check if it's a directory by trying to read it
          watchFile(filePath);
        } else {
          // Might be a directory
          watchDirectory(filePath);
        }
      })
      .catch(() => {
        // Assume it's a directory
        watchDirectory(filePath);
      });
  }

  console.log("👀 File watcher initialized");
};

// Cleanup watchers
export const cleanupWatcher = () => {
  for (const [path, watcher] of watchers) {
    watcher.close();
    watchedFiles.delete(path);
  }
  watchers.clear();
  console.log("🧹 File watcher cleaned up");
};
