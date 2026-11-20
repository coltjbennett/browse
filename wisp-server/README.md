# Classroom Wisp server

This folder is the separately deployed WebSocket backend for the Scramjet classroom demo. It uses the official `@mercuryworkshop/wisp-js` server API (Wisp v2) and is designed to be selected as the Render service's **Root Directory**.

## Run locally

Requirements: Node.js 22.12 or newer and npm.

```bash
cd wisp-server
npm install
npm start
```

The server listens on `0.0.0.0:$PORT` (or `0.0.0.0:5001` locally). Check `http://localhost:5001/healthz`. The WebSocket endpoint is `ws://localhost:5001/wisp/` locally. For the HTTPS-hosted frontend, Render supplies TLS, so use `wss://YOUR-RENDER-HOST/wisp/`.

## Deploy the existing Render service from this monorepo

In the existing Render Web Service settings, change its source to this same GitHub repository and set:

| Render setting | Value |
|---|---|
| Root Directory | `wisp-server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Keep the existing service name/domain if you want the frontend hostname to remain unchanged. Deploy after saving the settings. Render injects `PORT`; the server binds to `0.0.0.0` as required for hosted services.

Once deployed, the browser frontend's default endpoint is configured at the repository root in `static/config.js` as `wss://wisp-server-rk4m.onrender.com/wisp/`. Update that value if your Render hostname changes. The path is not guessed: this server explicitly accepts WebSocket upgrades only at `/wisp/`.

## Configuration

Edit `config.json`:

- `wispPath`: the WebSocket route; must begin and end with `/`. Default: `/wisp/`.
- `allowedHosts`: exact DNS hostnames. A configured hostname also permits its subdomains. The server enforces this allowlist, separately from the frontend's address-bar list.
- `allowedOrigins`: browser Origin patterns. `https://*.github.io` allows GitHub Pages project origins; local origins are included for local development. Add a custom Pages domain explicitly if you use one.
- `allowedPorts`: destination TCP ports. The default only allows 443 because the frontend requires HTTPS targets.
- `streamLimitPerHost` and `streamLimitTotal`: resource limits per Wisp client connection.
- `logLevel`: `DEBUG`, `INFO`, `WARN`, `ERROR`, or `NONE`.

Environment overrides:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP/WebSocket listen port; Render supplies this |
| `HOST` | Listen interface; defaults to `0.0.0.0` |
| `WISP_PATH` | WebSocket path, defaults to `config.json` |
| `ALLOWED_HOSTS` | Comma-separated hostname allowlist, overrides config |
| `ALLOWED_ORIGINS` | Comma-separated Origin patterns, overrides config |
| `WISP_LOG_LEVEL` | Overrides `logLevel` |

Example local override:

```bash
ALLOWED_HOSTS=example.com,www.w3.org npm start
```

When using environment variables in Render, set them in the service's Environment tab. Do not commit credentials or tokens.

## Security and classroom scope

This server is deliberately not an unrestricted general-purpose proxy. Its Wisp server settings permit only configured hostnames and the listed destination ports; direct-IP, private-IP, loopback, and UDP streams are disabled. The default frontend/server allowlists contain only the demonstration hosts `developer.mozilla.org`, `example.com`, and `www.w3.org`.

The Origin check is a browser-side access filter, **not authentication**: non-browser clients can spoof an Origin header. The destination hostname allowlist is the actual server-enforced restriction. Do not expose this as a public browsing service, do not widen the allowlist casually, and review Render logs and usage. The allowlist is a technical control, not a substitute for institutional network rules or supervised classroom use.

## Troubleshooting

- **Render deploy fails:** confirm Root Directory is exactly `wisp-server`, Build Command is `npm install`, and Start Command is `npm start`.
- **Service reports unhealthy:** open `/healthz`; confirm Render has supplied `PORT` and inspect deployment logs.
- **WebSocket 404:** the frontend endpoint must end in `/wisp/`, matching `config.wispPath` / `WISP_PATH`.
- **WebSocket 403:** check that the frontend's browser Origin matches `allowedOrigins`.
- **Proxy stream rejected:** confirm the requested hostname is in `allowedHosts` and the target uses destination port 443. Some pages depend on third-party hosts not yet approved; only add hosts after reviewing them for the classroom demo.
- **Upgrade works but requests fail:** check that the frontend transport uses Wisp v2 and that the server logs show the first proxied stream. A WebSocket 101 response alone does not prove the Wisp protocol handshake or a request works.

## API reference

The implementation uses `server.routeRequest(request, socket, head)`, `wisp.options`, and the `logging` exports documented by the upstream Wisp JS project: <https://github.com/MercuryWorkshop/wisp-js>. It does not use the archived `wisp-server-node` package.
