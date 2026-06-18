#!/usr/bin/env node
// Bundle the logo into a single, self-contained, deployable HTML file.
// Reads src/index.html, inlines every referenced asset (audio, images, fonts)
// as a data: URI, and writes dist/index.html.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(ROOT, "src");
const SRC = join(SRC_DIR, "index.html");
const OUT_DIR = join(ROOT, "dist");
const OUT = join(OUT_DIR, "index.html");

const MIME = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

let html = readFileSync(SRC, "utf8");

// Walk src/ for any asset whose extension we know how to inline. Reference paths
// in the HTML are relative to src/ (e.g. "assets/wow.mp3"), so match on that.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : full;
  });
const assets = walk(SRC_DIR).filter((f) => MIME[extname(f).toLowerCase()]);

let inlined = 0;
for (const file of assets) {
  const ref = relative(SRC_DIR, file).split(sep).join("/"); // posix path as used in HTML
  const dq = `"${ref}"`;
  const sq = `'${ref}'`;
  if (!html.includes(dq) && !html.includes(sq)) continue; // only if referenced
  const mime = MIME[extname(file).toLowerCase()];
  const uri = `data:${mime};base64,${readFileSync(file).toString("base64")}`;
  html = html.split(dq).join(`"${uri}"`).split(sq).join(`'${uri}'`);
  inlined++;
  console.log(`  inlined ${ref} → ${mime}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html);
console.log(
  `\nwrote dist/index.html — ${(html.length / 1024).toFixed(1)} KB, ${inlined} asset(s) inlined`,
);
