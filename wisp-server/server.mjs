
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");
const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));

function envList(name, fallback) {
  const value = process.env[name];
  return value === undefined || value.trim() === ""
    ? fallback
    : value.split(",").map((part) => part.trim()).filter(Boolean);
}

function validatePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/")) {
    throw new Error('config.wispPath must be an absolute URL path that starts and ends with "/".');
  }
  if (value.includes("?") || value.includes("#") || value.includes("\\") || value.includes("//")) {
    throw new Error("config.wispPath cannot contain query strings, fragments, backslashes, or repeated slashes.");
  }
  return value;
}

function validateHostname(value) {
  const hostname = String(value).trim().toLowerCase().replace(/\.$/, "");

  // Explicitly support "*" as an any-host wildcard.
  if (hostname === "*") return "*";

  if (!hostname || hostname.length > 253 || hostname.includes("*") || hostname.includes("/")) {
    throw new Error(`Invalid hostname in allowedHosts: ${value}`);
  }

  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) {
    throw new Error(`Invalid DNS hostname in allowedHosts: ${value}`);
  }

  return hostname;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostnamePattern(hostname) {
  // "*" permits any hostname.
  if (hostname === "*") {
    return /^.*$/i;
  }

  // Permit the configured hostname and its subdomains,
  // but not lookalike suffixes.
  return new RegExp(`^(?:[^.]+\\.)*${escapeRegex(hostname)}$`, "i");
}

function wildcardPattern(value) {
  const escaped = String(value)
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");

  return new RegExp(`^${escaped}$`, "i");
}

const wispPath = validatePath(process.env.WISP_PATH ?? config.wispPath);

const allowedHosts = envList("ALLOWED_HOSTS", config.allowedHosts)
  .map(validateHostname);

const allowedOrigins = envList("ALLOWED_ORIGINS", config.allowedOrigins);
const allowedPorts = config.allowedPorts;

if (allowedHosts.length === 0) {
  throw new Error("At least one allowed hostname is required.");
}

if (!Array.isArray(allowedPorts) || allowedPorts.length === 0 ||
    allowedPorts.some((port) =>
      !Number.isInteger(port) || port < 1 || port > 65535
    )) {
  throw new Error("config.allowedPorts must be a non-empty array of valid TCP port numbers.");
}

if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
  throw new Error("At least one allowed Origin pattern is required.");
}

const originPatterns = allowedOrigins.map(wildcardPattern);

const port = Number.parseInt(process.env.PORT ?? "5001", 10);
const host = process.env.HOST ?? "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

// Wisp server configuration.

wisp.options.wisp_version = 2;
wisp.options.hostname_whitelist = allowedHosts.map(hostnamePattern);
wisp.options.port_whitelist = allowedPorts;

wisp.options.allow_tcp_streams = true;
wisp.options.allow_udp_streams = true;
wisp.options.allow_direct_ip = true;
wisp.options.allow_private_ips = true;
wisp.options.allow_loopback_ips = true;

wisp.options.stream_limit_per_host = -1;
wisp.options.stream_limit_total = -1;

const logLevel = String(
  process.env.WISP_LOG_LEVEL ?? config.logLevel ?? "WARN"
).toUpperCase();

const levels = {
  DEBUG: logging.DEBUG,
  INFO: logging.INFO,
  WARN: logging.WARN,
  ERROR: logging.ERROR,
  NONE: logging.NONE
};

if (!(logLevel in levels)) {
  throw new Error(`Unsupported WISP_LOG_LEVEL: ${logLevel}. Use DEBUG, INFO, WARN, ERROR, or NONE.`);
}

logging.set_level(levels[logLevel]);

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload, null, 2);

  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });

  response.end(body);
}

function matchesAllowedOrigin(origin) {
  if (typeof origin !== "string" || origin === "null") return false;

  let parsed;

  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.origin !== origin) {
    return false;
  }

  return originPatterns.some((pattern) => pattern.test(origin));
}

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;

  const response = [
    `HTTP/1.1 ${status}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Cache-Control: no-store",
    "",
    body
  ].join("\r\n");

  socket.end(response);
}

const app = http.createServer((request, response) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`
  );

  if (request.method === "GET" && requestUrl.pathname === "/healthz") {
    return jsonResponse(response, 200, {
      ok: true,
      service: "scramjet-classroom-wisp-server",
      protocol: "Wisp v2",
      websocketPath: wispPath,
      allowedHostCount: allowedHosts.length,
      allowedHosts: allowedHosts,
      allowedPorts: allowedPorts
    });
  }

  if (request.method === "GET" && requestUrl.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });

    return response.end(
      `Classroom Wisp server is running. WebSocket endpoint: ${wispPath}\nHealth: /healthz\n`
    );
  }

  jsonResponse(response, 404, {
    ok: false,
    error: "Not found"
  });
});

app.on("upgrade", (request, socket, head) => {
  let pathname;

  try {
    pathname = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`
    ).pathname;
  } catch {
    return rejectUpgrade(socket, "400 Bad Request", "Malformed request URL.");
  }

  if (pathname !== wispPath) {
    return rejectUpgrade(
      socket,
      "404 Not Found",
      `Wisp endpoint not found. Expected ${wispPath}`
    );
  }

  const upgrade = String(request.headers.upgrade ?? "").toLowerCase();
  const connection = String(request.headers.connection ?? "").toLowerCase();

  if (
    upgrade !== "websocket" ||
    !connection.split(",").map((part) => part.trim()).includes("upgrade")
  ) {
    return rejectUpgrade(socket, "400 Bad Request", "A WebSocket upgrade is required.");
  }

  const origin = request.headers.origin;

  if (!matchesAllowedOrigin(origin)) {
    console.warn(
      `[Wisp] Rejected WebSocket upgrade from disallowed Origin: ${origin ?? "(missing)"}`
    );

    return rejectUpgrade(
      socket,
      "403 Forbidden",
      "This Origin is not permitted by the classroom server configuration."
    );
  }

  try {
    wisp.routeRequest(request, socket, head);
  } catch (error) {
    console.error("[Wisp] Failed to route WebSocket upgrade:", error);

    if (!socket.destroyed) {
      rejectUpgrade(
        socket,
        "500 Internal Server Error",
        "Wisp upgrade could not be routed."
      );
    }
  }
});

app.on("clientError", (error, socket) => {
  console.warn(`[HTTP] Client connection error: ${error.message}`);

  if (socket.writable) {
    rejectUpgrade(socket, "400 Bad Request", "Malformed HTTP request.");
  }
});

app.headersTimeout = 15_000;
app.requestTimeout = 30_000;
app.keepAliveTimeout = 5_000;

app.listen(port, host, () => {
  console.log(`[Wisp] Listening on http://${host}:${port}`);
  console.log(`[Wisp] WebSocket path: ${wispPath}`);
  console.log("[Wisp] Wisp protocol version: 2");
  console.log(`[Wisp] Allowed destinations: ${allowedHosts.join(", ")}`);
  console.log(`[Wisp] Allowed TCP ports: ${allowedPorts.join(", ")}`);
  console.log(`[Wisp] Allowed browser Origins: ${allowedOrigins.join(", ")}`);

  console.log("[Wisp] HTTP and HTTPS destination ports enabled.");
  console.log("[Wisp] UDP, direct-IP, private-IP, and loopback destinations are disabled.");
});

function shutdown(signal) {
  console.log(`[Wisp] Received ${signal}; closing server.`);

  app.close((error) => {
    if (error) {
      console.error("[Wisp] Error while closing HTTP server:", error);
      process.exitCode = 1;
    }
  });

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
