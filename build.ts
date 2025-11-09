// Load environment variables from .env file
import "bun";

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

// // Explicitly load .env file for build process
// // Bun auto-loads .env at runtime, but we need it during build for env: "inline"
// if (existsSync(".env")) {
//   const envFile = await Bun.file(".env").text();
//   let loadedCount = 0;
//   for (const line of envFile.split("\n")) {
//     const trimmed = line.trim();
//     if (!trimmed || trimmed.startsWith("#")) continue;

//     const equalIndex = trimmed.indexOf("=");
//     if (equalIndex === -1) continue;

//     const key = trimmed.slice(0, equalIndex).trim();
//     let value = trimmed.slice(equalIndex + 1).trim();

//     // Remove surrounding quotes if present
//     if (
//       (value.startsWith('"') && value.endsWith('"')) ||
//       (value.startsWith("'") && value.endsWith("'"))
//     ) {
//       value = value.slice(1, -1);
//     }

//     if (key) {
//       process.env[key] = value;
//       loadedCount++;
//     }
//   }
//   if (loadedCount > 0) {
//     console.log(
//       `📝 Loaded ${loadedCount} environment variable${loadedCount === 1 ? "" : "s"} from .env`
//     );
//   }
// }

// // Set NODE_ENV for production builds if not already set
// if (!process.env.NODE_ENV) {
//   process.env.NODE_ENV = "production";
// }
// console.log(`🔧 NODE_ENV=${process.env.NODE_ENV} (will be inlined in bundle)`);

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
});

if (!serverResult.success) {
  console.error("Server build failed");
  for (const message of serverResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

// FIX
// Post-process HTML files to ensure CSS links are present
// This fixes the issue where CSS imported in JS isn't linked in nested HTML routes
const htmlFiles = [...new Bun.Glob("**/*.html").scanSync(outdir)];
for (const htmlFile of htmlFiles) {
  const htmlPath = path.join(outdir, htmlFile);
  const htmlContent = await Bun.file(htmlPath).text();

  // Check if HTML has a script but no CSS link
  if (htmlContent.includes("<script") && !htmlContent.includes("<link")) {
    // Find the CSS chunk - look for CSS files in dist root
    const cssFiles = [...new Bun.Glob("chunk-*.css").scanSync(outdir)];
    if (cssFiles.length > 0) {
      // Determine relative path from HTML to CSS
      const htmlDir = path.dirname(htmlPath);
      const cssPath = path.join(outdir, cssFiles[0]);
      const relativePath = path.relative(htmlDir, cssPath);

      // Insert CSS link before script tag
      const updated = htmlContent.replace(
        /(<script[^>]*>)/,
        `<link rel="stylesheet" crossorigin href="${relativePath}">\n$1`
      );

      await Bun.write(htmlPath, updated);
      console.log(`🔗 Added CSS link to ${htmlFile}`);
    }
  }
}

const end = performance.now();
const buildTime = ((end - start) / 1000).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}s`);
console.log(`📁 Output directory: ${outdir}`);
console.log(`   - Generated ${serverResult.outputs.length} files`);
