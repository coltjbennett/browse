import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end("Bad request");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname);
  } catch {
    response.writeHead(400).end("Malformed URL");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(target);
    const type = MIME.get(path.extname(target).toLowerCase()) || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": pathname === "/sw.js" ? "no-cache" : "no-store"
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(error.code === "ENOENT" ? "Not found" : `Static server error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Scramjet classroom demo: http://${HOST}:${PORT}/`);
  console.log("Run npm run setup:proxy before opening the app so runtime bundles are present.");
});

server.on("error", (error) => {
  console.error(`Local static server failed: ${error.message}`);
  process.exitCode = 1;
});
