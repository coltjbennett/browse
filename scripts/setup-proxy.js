import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const VENDOR_ROOT = path.join(ROOT, "static", "vendor");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const detail = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed${error.status === null ? "" : ` (exit ${error.status})`}.${detail ? `\n${detail}` : ""}`
    );
  }
}

async function walkFiles(directory) {
  const found = [];
  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) found.push(fullPath);
    }
  }
  await visit(directory);
  return found;
}

async function unpackNpmPackage(spec, packageName, expectedVersion, tempRoot) {
  console.log(`Fetching official npm package ${spec}…`);
  const packOutput = run(NPM, [
    "pack",
    spec,
    "--json",
    "--pack-destination",
    tempRoot
  ], {
    env: {
      ...process.env,
      npm_config_registry: "https://registry.npmjs.org/"
    }
  });

  let packInfo;
  try {
    packInfo = JSON.parse(packOutput);
  } catch {
    throw new Error(`npm pack did not return JSON metadata for ${spec}. Output: ${packOutput}`);
  }
  const tarballName = packInfo?.[0]?.filename;
  if (!tarballName) throw new Error(`npm pack returned no tarball filename for ${spec}.`);

  const packageDir = path.join(tempRoot, `${packageName.replaceAll("/", "-")}-unpacked`);
  await fs.mkdir(packageDir, { recursive: true });
  run("tar", ["-xzf", path.join(tempRoot, tarballName), "-C", packageDir]);

  const extractedRoot = path.join(packageDir, "package");
  const packageMetadata = JSON.parse(await fs.readFile(path.join(extractedRoot, "package.json"), "utf8"));
  if (packageMetadata.name !== packageName || packageMetadata.version !== expectedVersion) {
    throw new Error(
      `Package identity mismatch for ${spec}: got ${packageMetadata.name}@${packageMetadata.version}. Refusing to copy unexpected files.`
    );
  }
  return { root: extractedRoot, metadata: packageMetadata };
}

async function findAsset(packageRoot, filename) {
  const files = await walkFiles(packageRoot);
  const matches = files.filter((file) => path.basename(file) === filename);
  if (matches.length === 0) {
    throw new Error(`The official package ${packageRoot} did not contain required file ${filename}.`);
  }
  matches.sort((a, b) => {
    const rank = (file) => file.includes(`${path.sep}dist${path.sep}`) ? 0 : 1;
    return rank(a) - rank(b) || a.length - b.length;
  });
  return matches[0];
}

async function copyAsset(packageRoot, filename, destination) {
  const source = await findAsset(packageRoot, filename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  console.log(`  ${path.relative(packageRoot, source)} -> ${path.relative(ROOT, destination)}`);
}

async function copyDirectory(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

async function main() {
  const packageJson = JSON.parse(await fs.readFile(PACKAGE_JSON, "utf8"));
  const pins = packageJson.proxyRuntime;
  if (!pins || typeof pins !== "object") {
    throw new Error("package.json is missing the proxyRuntime exact-version map.");
  }

  const required = [
    "@mercuryworkshop/scramjet",
    "@mercuryworkshop/scramjet-controller",
    "@mercuryworkshop/libcurl-transport"
  ];
  for (const name of required) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(pins[name] ?? "")) {
      throw new Error(`Missing or non-exact version pin for ${name} in package.json proxyRuntime.`);
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scramjet-setup-"));
  try {
    const [scramjet, controller, libcurl] = await Promise.all([
      unpackNpmPackage(`${required[0]}@${pins[required[0]]}`, required[0], pins[required[0]], tempRoot),
      unpackNpmPackage(`${required[1]}@${pins[required[1]]}`, required[1], pins[required[1]], tempRoot),
      unpackNpmPackage(`${required[2]}@${pins[required[2]]}`, required[2], pins[required[2]], tempRoot)
    ]);

    await fs.rm(VENDOR_ROOT, { recursive: true, force: true });
    const scramjetOut = path.join(VENDOR_ROOT, "scramjet");
    const controllerOut = path.join(VENDOR_ROOT, "controller");
    const libcurlOut = path.join(VENDOR_ROOT, "libcurl");

    await copyAsset(scramjet.root, "scramjet.js", path.join(scramjetOut, "scramjet.js"));
    await copyAsset(scramjet.root, "scramjet.wasm", path.join(scramjetOut, "scramjet.wasm"));
    await copyAsset(controller.root, "controller.api.js", path.join(controllerOut, "controller.api.js"));
    await copyAsset(controller.root, "controller.sw.js", path.join(controllerOut, "controller.sw.js"));
    await copyAsset(controller.root, "controller.inject.js", path.join(controllerOut, "controller.inject.js"));

    // Preserve the package's published dist/ and lib/ layout because its ESM
    // entrypoint may load sibling runtime resources using relative URLs.
    await copyDirectory(libcurl.root, libcurlOut);
    const transportEntry = path.join(libcurlOut, "dist", "index.mjs");
    await fs.access(transportEntry);

    const manifest = {
      packages: {
        [required[0]]: pins[required[0]],
        [required[1]]: pins[required[1]],
        [required[2]]: pins[required[2]]
      },
      browserFiles: [
        "scramjet/scramjet.js",
        "scramjet/scramjet.wasm",
        "controller/controller.api.js",
        "controller/controller.sw.js",
        "controller/controller.inject.js",
        "libcurl/dist/index.mjs"
      ]
    };
    await fs.writeFile(path.join(VENDOR_ROOT, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const requiredOutputs = [
      "scramjet/scramjet.js",
      "scramjet/scramjet.wasm",
      "controller/controller.api.js",
      "controller/controller.sw.js",
      "controller/controller.inject.js",
      "libcurl/dist/index.mjs"
    ];
    for (const relative of requiredOutputs) {
      await fs.access(path.join(VENDOR_ROOT, relative));
    }

    console.log("\nScramjet runtime setup complete. All required browser files were found and copied.");
    console.log("Pinned package versions:");
    for (const [name, version] of Object.entries(manifest.packages)) console.log(`  ${name}@${version}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("\nScramjet runtime setup failed.");
  console.error(error.stack || error.message || error);
  console.error("No partial success is reported. Check registry connectivity, the exact package versions, and the published bundle filenames.");
  process.exitCode = 1;
});
