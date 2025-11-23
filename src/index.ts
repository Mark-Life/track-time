import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

// Resolve to src/ directory
const SRC_DIR = import.meta.dir;

/**
 * Creates temporary files at project root for Bun's HTML bundler to resolve during dev mode
 * These files are needed because Bun processes HTML imports and tries to resolve all links
 * MUST be called BEFORE importing server module (which imports HTML files)
 */
const setupDevAssets = async (): Promise<(() => Promise<void>) | null> => {
  const nodeEnv = process.env.NODE_ENV;
  const bunEnv = process.env["BUN_ENV"];
  const isDistBuild = import.meta.dir.includes("/dist/");
  const isProduction =
    nodeEnv === "production" || bunEnv === "production" || isDistBuild;

  // Only create temp files in development
  if (isProduction) {
    return null;
  }

  const projectRoot = join(SRC_DIR, "..");
  const cleanup: Array<() => Promise<void>> = [];

  // Create temporary manifest.json
  const manifestPath = join(SRC_DIR, "assets", "manifest.json");
  const tempManifestPath = join(projectRoot, "manifest.json");
  if (existsSync(manifestPath)) {
    await cp(manifestPath, tempManifestPath);
    cleanup.push(() => rm(tempManifestPath, { force: true }));
  }

  // Create temporary apple-touch-icon.png
  const appleIconPath = join(SRC_DIR, "assets", "apple-touch-icon.png");
  const tempAppleIconPath = join(projectRoot, "apple-touch-icon.png");
  if (existsSync(appleIconPath)) {
    await cp(appleIconPath, tempAppleIconPath);
    cleanup.push(() => rm(tempAppleIconPath, { force: true }));
  }

  // Return cleanup function
  return async () => {
    await Promise.all(cleanup.map((fn) => fn()));
  };
};

// Setup dev assets BEFORE importing server (which imports HTML files)
const cleanupDevAssets = await setupDevAssets();

// Handle cleanup on process exit
if (cleanupDevAssets) {
  process.on("SIGINT", async () => {
    await cleanupDevAssets();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanupDevAssets();
    process.exit(0);
  });
}

// Import server AFTER creating temp files
const { startServer } = await import("./server");

await startServer();
