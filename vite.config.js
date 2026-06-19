import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build the logo into a single self-contained dist/index.html: Vite bundles +
// minifies the ES modules under src/, and vite-plugin-singlefile inlines the
// JS/CSS — plus the wow mp3 (via a huge assetsInlineLimit) — back into the one
// HTML file. Favicons + the web manifest live in src/public/ and are emitted
// as siblings in dist/.
export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
  },
  plugins: [viteSingleFile()],
});
