# Scramjet Browser Lab

A small, static browser-in-browser demonstration for studying Scramjet's request rewriting, Service Worker routing, controller/iframe lifecycle, the libcurl transport, and the Wisp WebSocket protocol.

This repository intentionally uses the newer Scramjet 2.x **controller + proxy-transports** architecture. It does not mix that API with the older BareMux integration. The selected Scramjet core is a prerelease, so the runtime versions are pinned exactly and should be upgraded as a tested set.

> **Backend included:** this monorepo now contains `wisp-server/`, a separately deployable Wisp v2 server. It explicitly accepts WebSocket upgrades at `/wisp/`, and the frontend default is `wss://wisp-server-rk4m.onrender.com/wisp/`. The existing Render service must be repointed to this repository's `wisp-server/` folder and redeployed before that endpoint will serve the new implementation.

## What the project demonstrates

- A web page loads Scramjet's browser runtime and controller API.
- A Service Worker is registered at the site's own subpath (important for GitHub Pages project sites).
- The controller registers a unique path prefix with the Service Worker.
- A Scramjet `Frame` owns the iframe and rewrites its navigation URL.
- The `LibcurlClient` transport is configured with a Wisp `wss://` endpoint.
- The Wisp protocol handshake and tunneled requests happen when the first proxied request is made.

The app starts with an address-bar allowlist containing a few public documentation/test hosts. That list is a **client-side demonstration guardrail only**. It is not a security boundary: a user can change client code, and it does not reliably constrain redirects, in-frame links, subresources, or direct requests. Do not use it as an access-control mechanism. Any real classroom policy must be enforced on the Wisp server or network side.

## Architecture

```text
Browser tab (GitHub Pages or localhost)
│
├── index.html / app.js / styles.css
│   ├── loads Scramjet core bundle ($scramjet)
│   ├── loads Scramjet controller bundle ($scramjetController)
│   └── creates LibcurlClient({ wisp: "wss://host/configured-prefix/" })
│
├── Controller
│   ├── owns transport + cookie jar
│   ├── registers a per-frame URL prefix with the Service Worker
│   └── creates a Scramjet Frame around the iframe
│
├── sw.js (same-origin Service Worker)
│   └── controller.sw.js: shouldRoute(event) → route(event)
│       └── forwards matching requests to the page controller over MessagePort
│
└── Scramjet Frame / iframe
    ├── rewrites navigation and resource requests under its registered prefix
    └── sends proxy requests through Libcurl transport
        │
        ▼
      WSS connection
        │
        ▼
Render-hosted Wisp server (`wisp-server/`; separate service, not hosted by GitHub Pages)
        │
        ▼
Approved destination hosts / ports (enforce policy server-side)
```

## Components

### Scramjet core

The Scramjet core bundle performs browser-side rewriting and provides the runtime used by proxied documents. The application loads the classic bundle before the controller API so the controller can perform its runtime-version check.

### Controller

`@mercuryworkshop/scramjet-controller` provides the page-side `Controller` and `Frame` API, plus separate Service Worker and injection bundles. The controller is initialized with the active `ServiceWorker`, a transport instance, and paths to the local Scramjet assets. `await controller.wait()` waits for its internal handshake and WASM setup before a frame is created.

### Service Worker

`sw.js` imports the upstream `controller.sw.js` bundle and forwards only requests for registered Scramjet frame prefixes. Ordinary app assets such as `app.js`, the runtime bundles, CSS, and the Service Worker itself are not routed through Scramjet. This prevents the Service Worker from intercepting its own dependencies recursively.

The worker is registered using a path relative to `app.js`, with scope equal to the current site directory. That is important on a GitHub Pages project site where the origin root (`/`) is not the project root (`/repository-name/`).

### Libcurl transport and Wisp

`transports/curl-ready.mjs` imports the published libcurl transport and uses its documented constructor shape:

```js
new LibcurlClient({ wisp: "wss://example.invalid/configured-prefix/" });
```

It validates the URL and returns the upstream transport instance without wrapping it in made-up methods. The supplied Wisp path is `/wisp/`, matching the included server's explicit route. If you change `wisp-server/config.json` or `WISP_PATH`, update the frontend endpoint in `static/config.js` to match.

A successful WebSocket upgrade is not proof that the Wisp protocol is compatible. Wisp v2 has its own INFO/CONTINUE/CLOSE negotiation after the WebSocket connection is established. In this app, actual compatibility is exercised by the first proxied request; the status panel deliberately does not claim a successful Wisp handshake merely because the transport object was constructed.

The Wisp protocol specification describes a configurable URL prefix and the trailing-slash convention: <https://github.com/MercuryWorkshop/wisp-protocol/blob/v2/protocol.md>. The upstream JavaScript Wisp implementation documents client and server support for Wisp v1/v2: <https://github.com/MercuryWorkshop/wisp-js> (server package version pinned to 0.5.3).

## Version pins and API choice

The runtime package pins are stored in `package.json` under `proxyRuntime`:

| Package | Pinned version | Purpose |
|---|---:|---|
| `@mercuryworkshop/scramjet` | `2.0.67-alpha.2` | Core runtime / request rewriter |
| `@mercuryworkshop/scramjet-controller` | `0.0.14` | Controller, frame, Service Worker bundles |
| `@mercuryworkshop/libcurl-transport` | `2.0.6` | Scramjet proxy transport over Wisp |

The upstream Scramjet demo on the `main` branch uses the newer `Controller`, `LibcurlClient`, and `defaultConfigDev` imports rather than the old BareMux constructor path. The project follows that API family, but uses the production `defaultConfig` rather than development flags. References:

- Scramjet source repository: <https://github.com/MercuryWorkshop/scramjet>
- Upstream demo initialization: <https://github.com/MercuryWorkshop/scramjet/blob/main/packages/demo/src/index.tsx>
- Controller source: <https://github.com/MercuryWorkshop/scramjet/blob/main/packages/controller/src/index.ts>
- Controller package: <https://www.npmjs.com/package/@mercuryworkshop/scramjet-controller>
- Libcurl transport package: <https://www.npmjs.com/package/@mercuryworkshop/libcurl-transport>

Scramjet 2.x is a prerelease line. This is not the same API as Scramjet 1.x and older examples using `$scramjetLoadController`, BareMux, or a legacy bare transport. Do not mix package versions from those examples with this repository.

The static frontend root has no third-party Node build dependencies; its `package-lock.json` locks the frontend tooling metadata. `scripts/setup-proxy.js` downloads the exact runtime package tarballs from the official npm registry and validates each package name/version before copying its browser assets. The independent `wisp-server/` package pins `@mercuryworkshop/wisp-js` to `0.5.3`; run `npm install` inside that directory to resolve its dependency tree and create/update its local package lock.

## Configuration

The frontend endpoint is configured in `static/config.js`:

```js
window.SCRAMJET_APP_CONFIG = Object.freeze({
  wispEndpoint: "wss://wisp-server-rk4m.onrender.com/wisp/",
  wispHostHint: "wisp-server-rk4m.onrender.com",
  defaultTarget: "https://developer.mozilla.org/",
  allowedDomains: ["developer.mozilla.org", "example.com", "www.w3.org"],
  keepAliveIntervalMs: 25000,
  serviceWorkerReadyTimeoutMs: 15000
});
```

The included server explicitly serves the Wisp WebSocket path `/wisp/`; its path is configured in `wisp-server/config.json`. Keep both sides in sync. The frontend UI also permits entering an endpoint at runtime and stores the accepted value in that browser's local storage.

The backend has a **separate, server-enforced** allowlist in `wisp-server/config.json`. Add a host in both lists only when it is approved for the classroom demonstration. The frontend list alone is not an access-control boundary. See [`wisp-server/README.md`](wisp-server/README.md) for the backend's environment variables, origin rules, and host/port restrictions.

## Wisp backend deployment (existing Render service)

The backend now lives in this repository under `wisp-server/`. Replace the existing Render service's source configuration with this repository and set the service's **Root Directory** to `wisp-server`. Use these exact commands:

| Render setting | Value |
|---|---|
| Root Directory | `wisp-server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Render supplies `PORT`. The app binds to `0.0.0.0` and reports health at `/healthz`. If you keep the existing service name/domain `wisp-server-rk4m.onrender.com`, the frontend endpoint is already set. Otherwise, change `wispEndpoint` in `static/config.js` to the new Render hostname. The backend deployment is independent of GitHub Pages deployment.

Do not expose this as an unrestricted public proxy. The included backend only allows the configured demonstration destinations on TCP port 443, and disables UDP, direct-IP, private-IP, and loopback streams. Its Origin filter is only an additional browser filter, not authentication; the destination allowlist is the server-side restriction.

## Run locally

Requirements: Node.js 22.12+ and npm 10+.

In one terminal, start the Wisp backend:

```bash
cd wisp-server
npm install
npm start
```

In a second terminal, prepare and start the static frontend from the repository root:

```bash
npm ci
npm run setup:proxy
npm run check
npm run build
npm run dev
```

Open <http://127.0.0.1:4173/>. `localhost` is treated as a secure context by modern browsers, so the Service Worker can register over local HTTP. For a local frontend, add `http://localhost:4173` / `http://127.0.0.1:4173` patterns to `wisp-server/config.json` if you change the default port. The setup command downloads official package tarballs and copies runtime bundles into `static/vendor/`; it is safe to run repeatedly.

If the frontend setup command fails, it stops with the package/asset name and error output. It does not create fake placeholder runtime bundles. `npm run build` intentionally fails until all required vendor assets are present.

## Deploy to GitHub Pages

1. Extract the ZIP package.
2. Rename the top-level `github/` directory to `.github/` before adding/pushing the files to your GitHub repository. GitHub Actions only discovers workflows in `.github/workflows/`.
3. Keep the repository structure at its root (do not push an extra enclosing directory).
4. Commit and push to the `main` branch.
5. In the GitHub repository settings, open **Pages** and select **GitHub Actions** as the build/deployment source.
6. The workflow runs `npm ci`, source checks, `npm run setup:proxy`, and `npm run build`, then deploys the `dist/` artifact.
7. Deploy the Render backend from the `wisp-server/` root directory, then open the Pages URL and test an approved host.

The workflow uses the Actions versions requested for this project: `checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`, and `deploy-pages@v4`.

### Static frontend vs Wisp backend

GitHub Pages only serves static files. It cannot run the Wisp WebSocket server or accept WebSocket upgrades on the project's behalf. The Render service remains a separate backend. It must be deployed, healthy, configured for Wisp, and reachable over TLS/WSS. Setting a frontend URL does not deploy or configure the backend.

## Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| `Service Workers require a secure context` | Use GitHub Pages HTTPS or `http://localhost`, not a LAN IP over plain HTTP. |
| Worker does not control the page | Check the project subpath, hard-reload once after the first registration, and inspect the registered scope in DevTools. |
| `controller.api.js` / Scramjet runtime file is 404 | Run `npm run setup:proxy`; check the `static/vendor/` files are deployed under the repository path. |
| Runtime version mismatch | Keep the exact version pins together; clear the site's old Service Worker/cache and redeploy all generated runtime files. |
| Missing Wisp path | Use `wss://YOUR-RENDER-HOST/wisp/`; the included server accepts this exact route. Keep a trailing slash. |
| WebSocket handshake fails | Check Render health, TLS certificate, WSS upgrade support, path routing, proxy/origin rules, and server logs. |
| WebSocket opens but the first proxied request fails | The server may not speak a compatible Wisp version or may reject the protocol handshake/stream. Check the Wisp server logs; a plain WebSocket upgrade is not sufficient. |
| A page is blank or refuses to load | Inspect the browser console and iframe. Some sites block embedding or depend on browser features, authentication, anti-bot checks, or policies that a rewrite layer cannot make universally compatible. |
| GitHub Pages deploys an empty/old page | Confirm the workflow is in `.github/workflows/static.yml`, Pages source is GitHub Actions, and the build artifact is `dist/`. |

For a project site, do not change the Service Worker or runtime paths to absolute origin-root paths unless you also change the Pages base-path design. This implementation derives those paths relative to `app.js` so `/repository-name/` deployments remain in scope.

## Testing checklist

### Checks performed while preparing this repository

- Source files and required directory layout were created.
- JavaScript syntax and package metadata are checked by `npm run check`.
- The root frontend npm lockfile describes the static-site tooling metadata; the Wisp backend has an independent pinned runtime dependency and its own `npm install` lifecycle.
- `setup-proxy.js` uses exact package pins, official npm registry access, package identity checks, and required-output checks.
- The Service Worker wrapper calls the documented `shouldRoute(event)` before `route(event)`.
- The page-side wiring follows the upstream `Controller` / `LibcurlClient` constructor shape and waits for `controller.wait()` before creating the frame.
- GitHub Actions paths and `dist/` artifact name match the build script.

### Checks that require a networked machine / your deployment

- `npm run setup:proxy` package downloads and real package file layout.
- `npm run build` after those vendor assets are downloaded.
- Live browser Service Worker registration, runtime initialization, and iframe navigation.
- The live Render WebSocket path `/wisp/`, TLS/WSS upgrade, Wisp INFO/CONTINUE negotiation, server version, and proxy request success after the Render service is repointed to `wisp-server/`.
- The GitHub Pages deployment and behavior from its final repository subpath.
- Mobile Safari behavior on the deployed HTTPS URL.

The frontend source/structure checks and Wisp server JavaScript syntax check passed while preparing this repository. External package downloads timed out in the file-generation environment, so I could not install `@mercuryworkshop/wisp-js`, start the backend with the real dependency, or run the frontend runtime installer/build. The Wisp server route is explicitly defined by this source as `/wisp/`, but the existing Render deployment has not yet been repointed or tested with this new server. Therefore a live Wisp handshake and end-to-end proxied request are **not** claimed as verified. Run the networked checks above after `npm install` and after redeploying Render.

## Legal and operational notes

Scramjet and its transport packages have their own upstream license terms; the Wisp JS server package is published under LGPL-3.0-or-later. Review the actual license files included in the installed packages before redistributing the generated runtime assets. Keep this as a private classroom demonstration unless you have reviewed the legal and operational requirements for any broader deployment.
