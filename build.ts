// Load environment variables from .env file
import "bun";

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
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
console.log("📦 Building server with HTML imports...");

const serverResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir,
  target: "bun",
  minify: true,
  sourcemap: "external",
  plugins: [tailwindPlugin],
  env: "inline",
  publicPath: "/",
});

if (!serverResult.success) {
  console.error("Server build failed");
  for (const message of serverResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

const end = performance.now();
const buildTime = ((end - start) / 1000).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}s`);
console.log(`📁 Output directory: ${outdir}`);
console.log(`   - Generated ${serverResult.outputs.length} files`);
