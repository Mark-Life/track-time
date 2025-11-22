#!/usr/bin/env bun
/**
 * Generates PNG icons from SVG for PWA support
 * Requires: sharp (install with: bun add -d sharp)
 * 
 * Usage: bun run scripts/generate-icons.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const sizes = [
  { size: 180, name: "apple-touch-icon" }, // iOS
  { size: 192, name: "icon-192" }, // Android
  { size: 512, name: "icon-512" }, // Android/PWA
];

const assetsDir = join(import.meta.dir, "..", "src", "assets");
const iconSvgPath = join(assetsDir, "icon-pwa.svg");

async function generateIcons() {
  // Check if sharp is available
  let sharp: typeof import("sharp");
  try {
    sharp = await import("sharp");
  } catch {
    console.error("❌ Error: sharp is not installed.");
    console.log("📦 Install it with: bun add -d sharp");
    console.log("\n💡 Alternative: Use an online SVG to PNG converter:");
    console.log("   1. Open src/assets/icon-pwa.svg");
    console.log("   2. Convert to PNG at sizes: 180x180, 192x192, 512x512");
    console.log("   3. Save as apple-touch-icon.png, icon-192.png, icon-512.png");
    console.log("   4. Place them in src/assets/");
    process.exit(1);
  }

  if (!existsSync(iconSvgPath)) {
    console.error(`❌ Error: ${iconSvgPath} not found`);
    process.exit(1);
  }

  console.log("🎨 Generating PNG icons from SVG...\n");

  for (const { size, name } of sizes) {
    try {
      const outputPath = join(assetsDir, `${name}.png`);
      await sharp.default(iconSvgPath)
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 1 }, // Black background
        })
        .png()
        .toFile(outputPath);
      
      console.log(`   ✓ Generated ${name}.png (${size}x${size})`);
    } catch (error) {
      console.error(`   ✗ Failed to generate ${name}.png:`, error);
    }
  }

  console.log("\n✅ Icon generation complete!");
  console.log("📝 Don't forget to update manifest.json with the new icon paths");
}

generateIcons().catch(console.error);

