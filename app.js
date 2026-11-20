const config = window.SCRAMJET_APP_CONFIG ?? {};
const APP_BASE = new URL("./", import.meta.url);
const allowedDomains = Array.isArray(config.allowedDomains) ? config.allowedDomains : [];
const serviceWorkerTimeout = Number(config.serviceWorkerReadyTimeoutMs) || 15000;

const $ = (selector) => document.querySelector(selector);
const statusPill = $("#runtime-status");
const statusText = $("#runtime-status-text");
const pageStatus = $("#page-status");
const addressInput = $("#address-input");
const wispInput = $("#wisp-endpoint");
const iframe = $("#browser-frame");
const placeholder = $("#frame-placeholder");
const activityLog = $("#activity-log");

let registration = null;
let serviceWorker = null;
let controller = null;
let frame = null;
let activeWispEndpoint = null;
let keepAliveHandle = null;
let runtimeReady = false;

function appUrl(path) {
  return new URL(path, APP_BASE);
}

function readSavedEndpoint() {
  try { return localStorage.getItem("scramjet-classroom-wisp-endpoint") || ""; }
  catch { return ""; }
}

function saveEndpoint(endpoint) {
  try { localStorage.setItem("scramjet-classroom-wisp-endpoint", endpoint); }
  catch (error) { log(`Could not persist Wisp endpoint in local storage: ${error.message}`); }
}

function appPath(path) {
  return appUrl(path).pathname;
}

function setRuntimeStatus(message, kind = "pending") {
  statusText.textContent = message;
  statusPill.className = `status-pill ${kind}`;
}

function setPageStatus(message) {
  pageStatus.textContent = message;
}

function log(message, kind = "info") {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  item.textContent = `${time} — ${message}`;
  item.dataset.kind = kind;
  activityLog.prepend(item);
  while (activityLog.children.length > 12) activityLog.lastElementChild.remove();
  if (kind === "error") console.error(`[Scramjet Lab] ${message}`);
  else console.info(`[Scramjet Lab] ${message}`);
}

function loadClassicScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = appUrl(path).href;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load required runtime script: ${script.src}`));
    document.head.append(script);
  });
}

function waitForServiceWorkerControl(timeoutMs) {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve(navigator.serviceWorker.controller);
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      reject(new Error(
        "The Service Worker activated but did not take control of this page within the timeout. Reload once; if that repeats, check the SW scope and Pages base path."
      ));
    }, timeoutMs);

    function onChange() {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      resolve(worker);
    }

    navigator.serviceWorker.addEventListener("controllerchange", onChange);
  });
}

async function initializeRuntime() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support Service Workers. Use a current browser over HTTPS or localhost.");
  }
  if (!window.isSecureContext) {
    throw new Error("Service Workers require a secure context. Use HTTPS on GitHub Pages or http://localhost for local testing.");
  }

  setRuntimeStatus("Loading Scramjet runtime…");
  log("Loading Scramjet core and controller bundles.");

  await loadClassicScript("static/vendor/scramjet/scramjet.js");
  if (!window.$scramjet) {
    throw new Error("Scramjet core bundle loaded but window.$scramjet was not created. Check the downloaded package files.");
  }

  await loadClassicScript("static/vendor/controller/controller.api.js");
  if (!window.$scramjetController?.Controller) {
    throw new Error("Scramjet controller bundle loaded but $scramjetController.Controller is missing.");
  }
  window.$scramjetController.assertRuntimeScramjetVersion();

  const swUrl = appUrl("sw.js");
  const scope = APP_BASE.pathname;
  log(`Registering Service Worker at ${swUrl.pathname} with scope ${scope}.`);
  registration = await navigator.serviceWorker.register(swUrl.href, {
    scope,
    updateViaCache: "none"
  });

  await navigator.serviceWorker.ready;
  serviceWorker = await waitForServiceWorkerControl(serviceWorkerTimeout);

  if (keepAliveHandle !== null) window.clearInterval(keepAliveHandle);
  keepAliveHandle = window.setInterval(() => {
    const worker = navigator.serviceWorker.controller ?? serviceWorker;
    worker?.postMessage("classroom-demo-ping");
  }, Number(config.keepAliveIntervalMs) || 25000);

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "classroom-demo-pong") {
      // A pong confirms the worker is responsive, not that Wisp is connected.
      return;
    }
    log("Received a Service Worker diagnostic message.");
  });

  runtimeReady = true;
  setRuntimeStatus("Runtime ready; Wisp not connected", "good");
  log("Service Worker is controlling this page. Scramjet runtime initialized.");
  setPageStatus("Enter the configured Wisp endpoint, connect, then browse an approved domain.");
}

function normalizeTarget(rawValue) {
  const input = String(rawValue ?? "").trim();
  if (!input) throw new Error("Enter a demonstration URL first.");

  let target;
  try {
    target = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch (error) {
    throw new Error(`That address is not a valid URL: ${error.message}`);
  }

  if (target.protocol !== "https:") {
    throw new Error("For this classroom build, demonstration targets must use HTTPS.");
  }
  if (target.username || target.password) {
    throw new Error("Do not include a username or password in a demonstration URL.");
  }

  const allowed = allowedDomains.some((domain) => {
    const host = String(domain).toLowerCase().trim();
    const targetHost = target.hostname.toLowerCase();
    return host && (targetHost === host || targetHost.endsWith(`.${host}`));
  });

  if (!allowed) {
    throw new Error(`Host “${target.hostname}” is not in the address-bar allowlist. Edit static/config.js to add an approved classroom demo host.`);
  }

  return target;
}

function renderAllowlist() {
  const list = $("#allowlist");
  list.replaceChildren();
  for (const domain of allowedDomains) {
    const item = document.createElement("li");
    item.textContent = domain;
    list.append(item);
  }
}

function setNavigationEnabled(enabled) {
  $("#back-button").disabled = !enabled;
  $("#forward-button").disabled = !enabled;
  $("#reload-button").disabled = !enabled;
}

async function connectWisp() {
  if (!runtimeReady || !serviceWorker) {
    throw new Error("Scramjet is not initialized yet. Wait for the runtime status to become ready.");
  }
  if (!wispInput.value.trim()) {
    throw new Error(`Wisp endpoint is missing. Enter the full wss:// URL, including the configured path and trailing slash for ${config.wispHostHint || "your Wisp server"}.`);
  }

  const transportModule = await import("./transports/curl-ready.mjs");
  const endpoint = transportModule.validateWispEndpoint(wispInput.value);
  if (controller) {
    if (endpoint !== activeWispEndpoint) {
      throw new Error("A controller is already running with a different Wisp endpoint. Reload this page to change endpoints safely.");
    }
    return;
  }

  const transport = transportModule.createCurlTransport(endpoint);
  const Controller = window.$scramjetController.Controller;
  const prefix = appPath("~sj/");
  const wasmPath = appPath("static/vendor/scramjet/scramjet.wasm");

  setRuntimeStatus("Initializing Scramjet controller…", "pending");
  setPageStatus("Initializing controller; Wisp protocol negotiation will occur on the first proxied request.");
  log(`Creating libcurl transport for ${new URL(endpoint).host}${new URL(endpoint).pathname}.`);

  controller = new Controller({
    serviceworker: serviceWorker,
    transport,
    config: {
      prefix,
      scramjetPath: appPath("static/vendor/scramjet/scramjet.js"),
      injectPath: appPath("static/vendor/controller/controller.inject.js"),
      wasmPath
    },
    scramjetConfig: window.$scramjet.defaultConfig
  });

  try {
    await controller.wait();
  } catch (error) {
    controller = null;
    throw new Error(`Scramjet controller initialization failed: ${error.message}`);
  }

  activeWispEndpoint = endpoint;
  saveEndpoint(endpoint);
  frame = controller.createFrame(iframe);
  setNavigationEnabled(true);
  setRuntimeStatus("Controller ready; Wisp handshake pending", "good");
  setPageStatus("Controller initialized. The Wisp protocol is not verified until the first proxied request succeeds.");
  log("Controller handshake and Scramjet WASM initialization completed.");
  log("A WebSocket upgrade alone is not treated as proof of Wisp protocol compatibility.");
}

async function navigate() {
  const target = normalizeTarget(addressInput.value);
  addressInput.value = target.href;

  if (!controller || !frame) await connectWisp();
  if (!frame) throw new Error("Scramjet frame was not created after controller initialization.");

  placeholder.classList.add("hidden");
  setPageStatus(`Opening ${target.hostname}; Wisp protocol and transport are being exercised.`);
  setRuntimeStatus("Proxied request in progress…", "pending");
  log(`Navigating the Scramjet frame to ${target.href}.`);
  frame.go(target.href);
}

function reportError(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  setRuntimeStatus("Initialization or navigation error", "bad");
  setPageStatus(`${context}: ${message}`);
  log(`${context}: ${message}`, "error");
}

$("#connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await connectWisp();
  } catch (error) {
    reportError(error, "Wisp connection setup failed");
  }
});

$("#address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await navigate();
  } catch (error) {
    reportError(error, "Navigation blocked or failed");
  }
});

$("#back-button").addEventListener("click", () => {
  try { frame?.back(); setPageStatus("Back navigation requested."); }
  catch (error) { reportError(error, "Back navigation failed"); }
});
$("#forward-button").addEventListener("click", () => {
  try { frame?.forward(); setPageStatus("Forward navigation requested."); }
  catch (error) { reportError(error, "Forward navigation failed"); }
});
$("#reload-button").addEventListener("click", () => {
  try { frame?.reload(); setPageStatus("Reload requested."); }
  catch (error) { reportError(error, "Reload failed"); }
});
$("#clear-log-button").addEventListener("click", () => activityLog.replaceChildren());

iframe.addEventListener("load", () => {
  if (!frame) return;
  setRuntimeStatus("Frame load event received", "good");
  setPageStatus("The iframe emitted a load event. This alone does not prove that the remote page or Wisp protocol succeeded; inspect the frame and logs.");
  log("Iframe load event received (not a Wisp compatibility assertion).");
});

window.addEventListener("unhandledrejection", (event) => {
  reportError(event.reason, "Unhandled promise rejection");
});
window.addEventListener("error", (event) => {
  if (event.error) reportError(event.error, "Browser runtime error");
});

async function boot() {
  renderAllowlist();
  addressInput.value = config.defaultTarget || "https://example.com/";
  wispInput.value = config.wispEndpoint || readSavedEndpoint();
  try {
    await initializeRuntime();
    if (wispInput.value.trim()) {
      setPageStatus("Runtime ready. Press Connect to initialize the configured transport.");
    }
  } catch (error) {
    reportError(error, "Runtime initialization failed");
  }
}

void boot();
