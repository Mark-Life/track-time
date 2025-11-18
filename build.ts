// Load environment variables from .env file
import "bun";

import { existsSync, mkdirSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

// Ensure .env is loaded (Bun should do this automatically, but being explicit)
if (existsSync(".env")) {
  console.log("📝 Loading .env file...");
}

const outdir = "./dist";

// Clean previous build
if (existsSync(outdir)) {
  console.log("🗑️  Cleaning previous build...");
  await rm(outdir, { recursive: true, force: true });
}

console.log("\n🚀 Starting build process...\n");

const start = performance.now();

// Build the server entry point which includes HTML imports
// Bun's bundler automatically processes HTML imports and bundles frontend assets
// HTML imports (landing, login) will be bundled as manifest objects
// Filesystem-served HTML (/app routes) will be resolved at runtime using import.meta.dir
console.log("📦 Building server with HTML imports...");

const serverResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir,
  target: "bun",
  minify: true,
  sourcemap: "external",
  plugins: [tailwindPlugin],
  // Don't inline NODE_ENV - we need to read it at runtime for production checks
  // Use "disable" to prevent inlining, or specify which vars to inline
  // env: "inline", // This would inline all env vars at build time
  // Public path for assets
  publicPath: "/",
  // Bundle all dependencies (including node_modules)
  packages: "bundle",
  // Set root directory for path resolution
  root: ".",
});

if (!serverResult.success) {
  console.error("❌ Server build failed");
  for (const message of serverResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

// Copy source files needed at runtime (HTML files served from filesystem)
// The server code uses import.meta.dir to resolve paths, so we need to preserve directory structure
console.log("\n📋 Copying source files for runtime...");

// Copy source directories to match the bundled structure (dist/src/)
// The server code uses import.meta.dir which will be in dist/src/server/
// So paths like ${SRC_DIR}/app/app/index.html resolve to dist/src/app/app/index.html
const sourceDirs = [
  { from: "src/app", to: join(outdir, "src/app") },
  { from: "src/lib", to: join(outdir, "src/lib") },
];

for (const { from, to } of sourceDirs) {
  if (existsSync(from)) {
    // Ensure destination directory exists
    mkdirSync(to, { recursive: true });
    await cp(from, to, { recursive: true });
    console.log(`   ✓ Copied ${from} → ${to}`);
  }
}

// Copy global.css file (needed for ~/global.css path resolution)
const globalCssPath = join("src", "global.css");
const distGlobalCssPath = join(outdir, "src", "global.css");
if (existsSync(globalCssPath)) {
  await cp(globalCssPath, distGlobalCssPath);
  console.log(`   ✓ Copied ${globalCssPath} → ${distGlobalCssPath}`);
}

const end = performance.now();
const buildTime = ((end - start) / 1000).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}s`);
console.log(`📁 Output directory: ${outdir}`);
console.log(`   - Generated ${serverResult.outputs.length} bundled file(s)`);
console.log("   - Copied source directories for runtime");

// List generated files
if (serverResult.outputs.length > 0) {
  console.log("\n📄 Bundled files:");
  for (const output of serverResult.outputs) {
    const sizeKB = (output.size / 1024).toFixed(2);
    console.log(`   - ${output.path} (${sizeKB} KB)`);
  }
}

console.log("\n💡 To start the server:");
console.log("   bun run start");
console.log(
  `   or: cd ${outdir} && NODE_ENV=production bun run --bun --env-file=../.env src/index.js`
);
