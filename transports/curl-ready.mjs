/**
 * Browser-side adapter for the supported Scramjet 2.x proxy-transports API.
 *
 * Upstream's current demo constructs LibcurlClient with `{ wisp: url }`.
 * This adapter validates the exact WebSocket URL first, then returns the
 * upstream transport instance unchanged. It intentionally does not invent
 * transport methods or claim that construction proves protocol compatibility.
 */
import LibcurlClient from "../static/vendor/libcurl/dist/index.mjs";

/**
 * Validate a Wisp WebSocket URL.
 *
 * A path must be explicit, and must end with `/`. `/` is accepted only when
 * it is explicitly present in the input string; this module never fills it in.
 *
 * @param {string} value
 * @returns {string} Canonical WSS URL.
 */
export function validateWispEndpoint(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      "Wisp endpoint is missing. Enter the full wss:// URL, including the server's configured path and trailing slash."
    );
  }

  const input = value.trim();
  const explicitPath = /^wss:\/\/[^/?#]+(\/[^?#]*)?(?:\?[^#]*)?(?:#[\s\S]*)?$/i.exec(input);

  if (!explicitPath || explicitPath[1] === undefined) {
    throw new Error(
      "Wisp URL path was not supplied. Enter the exact path from the Render Wisp server configuration; this project will not guess `/` or `/wisp/`."
    );
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new Error(`Invalid Wisp WebSocket URL: ${error.message}`);
  }

  if (parsed.protocol !== "wss:") {
    throw new Error(
      `Wisp endpoint must use wss:// on an HTTPS deployment; received ${parsed.protocol || "no protocol"}.`
    );
  }
  if (!parsed.hostname) {
    throw new Error("Wisp endpoint must include a hostname.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not put credentials in the Wisp URL.");
  }
  if (parsed.hash) {
    throw new Error("Wisp endpoint URLs must not contain a fragment.");
  }
  if (!parsed.pathname.endsWith("/")) {
    throw new Error(
      "Wisp endpoint path must end with `/` according to the Wisp WebSocket URL convention."
    );
  }

  return parsed.href;
}

/**
 * Construct the upstream libcurl transport.
 * The actual Wisp handshake is deferred until the transport opens a tunnel.
 *
 * @param {string} endpoint Full WSS endpoint, including configured path.
 */
export function createCurlTransport(endpoint) {
  const wisp = validateWispEndpoint(endpoint);
  try {
    return new LibcurlClient({ wisp });
  } catch (error) {
    throw new Error(`Could not construct the Scramjet libcurl transport: ${error.message}`);
  }
}
