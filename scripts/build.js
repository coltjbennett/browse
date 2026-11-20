import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

async function copyTree(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

async function requireFile(relative) {
  const full = path.join(ROOT, relative);
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size === 0) throw new Error("file is empty or not a regular file");
  } catch (error) {
    throw new Error(`Required build input is missing: ${relative}. Run ` +
      `npm run setup:proxy first. (${error.message})`);
  }
}

async function main() {
  const required = [
    "index.html",
    "app.js",
    "styles.css",
    "sw.js",
    "static/config.js",
    "transports/curl-ready.mjs",
    "static/vendor/scramjet/scramjet.js",
    "static/vendor/scramjet/scramjet.wasm",
    "static/vendor/controller/controller.api.js",
    "static/vendor/controller/controller.sw.js",
    "static/vendor/controller/controller.inject.js",
    "static/vendor/libcurl/dist/index.mjs"
  ];
  for (const file of required) await requireFile(file);

  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  for (const file of ["index.html", "app.js", "styles.css", "sw.js"]) {
    await fs.copyFile(path.join(ROOT, file), path.join(DIST, file));
  }
  await copyTree(path.join(ROOT, "static"), path.join(DIST, "static"));
  await copyTree(path.join(ROOT, "transports"), path.join(DIST, "transports"));
  await fs.writeFile(path.join(DIST, ".nojekyll"), "");

  console.log(`Static site prepared at ${path.relative(ROOT, DIST)}.`);
  console.log("GitHub Pages artifact includes the Scramjet runtime bundles and transport assets.");
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
