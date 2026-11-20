/*
 * Classroom demo configuration.
 * The bundled Wisp backend in wisp-server/server.mjs explicitly serves /wisp/.
 * Update the hostname if you deploy the backend under a different Render URL.
 */
window.SCRAMJET_APP_CONFIG = Object.freeze({
  wispEndpoint: "wss://wisp-server-rk4m.onrender.com/wisp/",
  wispHostHint: "wisp-server-rk4m.onrender.com",
  defaultTarget: "https://google.com",
  allowedDomains: [
    "*"
  ],
  keepAliveIntervalMs: 25000,
  serviceWorkerReadyTimeoutMs: 15000
});
