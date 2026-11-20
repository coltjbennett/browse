import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "index.html", "app.js", "styles.css", "sw.js", "static/config.js",
  "scripts/setup-proxy.js", "scripts/build.js", "scripts/check-project.js",
  "scripts/serve.js", "transports/curl-ready.mjs", "package.json", "package-lock.json",
  ".github/workflows/static.yml", "README.md", "wisp-server/package.json",
  "wisp-server/server.mjs", "wisp-server/config.json", "wisp-server/README.md", "wisp-server/.env.example"
];
const syntaxFiles = ["app.js", "sw.js", "static/config.js", "scripts/setup-proxy.js", "scripts/build.js", "scripts/serve.js", "transports/curl-ready.mjs", "wisp-server/server.mjs"];

for (const relative of files) {
  await fs.access(path.join(ROOT, relative));
}

for (const relative of syntaxFiles) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, relative)], { stdio: "inherit" });
}

const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(await fs.readFile(path.join(ROOT, "package-lock.json"), "utf8"));
if (packageJson.name !== lock.name || packageJson.version !== lock.version || lock.lockfileVersion !== 3) {
  throw new Error("package.json and package-lock.json metadata do not match.");
}

const wispPackage = JSON.parse(await fs.readFile(path.join(ROOT, "wisp-server/package.json"), "utf8"));
const wispConfig = JSON.parse(await fs.readFile(path.join(ROOT, "wisp-server/config.json"), "utf8"));
if (wispPackage.scripts?.start !== "node server.mjs" || wispPackage.dependencies?.["@mercuryworkshop/wisp-js"] !== "0.5.3") {
  throw new Error("Wisp server startup script or pinned Wisp dependency is inconsistent.");
}
if (wispConfig.wispPath !== "/wisp/" || !Array.isArray(wispConfig.allowedHosts) || !wispConfig.allowedHosts.length) {
  throw new Error("Wisp server configuration is missing its expected /wisp/ path or hostname allowlist.");
}
console.log(`Project structure and JavaScript syntax checks passed (${files.length} required files).`);
console.log("This check does not install the Wisp runtime or prove a live Render/Wisp connection.");
