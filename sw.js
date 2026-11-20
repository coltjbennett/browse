/*
 * Scramjet 2.x Service Worker entry point.
 *
 * The official controller SW bundle exposes shouldRoute() and route() on
 * $scramjetController. We only forward requests registered to a Scramjet
 * frame prefix. This avoids recursively intercepting this app's own assets.
 */
importScripts("./static/vendor/controller/controller.sw.js");

self.addEventListener("fetch", (event) => {
  const api = self.$scramjetController;
  if (!api || typeof api.shouldRoute !== "function" || typeof api.route !== "function") {
    return;
  }

  try {
    if (api.shouldRoute(event)) {
      event.respondWith(api.route(event));
    }
  } catch (error) {
    console.error("[Scramjet SW] Failed to inspect request route:", error);
    event.respondWith(
      new Response(`Scramjet Service Worker route error: ${error.message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      })
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "classroom-demo-ping") {
    // The upstream controller keeps its own routing table in worker memory.
    // This no-op message also wakes a suspended worker between navigations.
    event.source?.postMessage({ type: "classroom-demo-pong", at: Date.now() });
  }
});
