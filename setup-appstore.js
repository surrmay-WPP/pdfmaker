import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const pkgPath = path.join(scriptDir, "package.json");
const exeCachePath = path.join(scriptDir, ".oneview-exe-path");
const DEV_URL = process.env.ONEVIEW_DEV_URL || "http://localhost:5173";

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return "";
  return (result.stdout || "").trim();
}

function installPackage(pkgName) {
  console.log(`Installing ${pkgName}...`);

  const result = spawnSync("npm", ["install", pkgName], {
    stdio: "inherit",
    shell: true
  });

  if (result.status !== 0) {
    console.error(`Failed to install ${pkgName}`);
    process.exit(1);
  }

  console.log(`${pkgName} installed successfully`);
}


function isPackageInstalled(pkgName) {
  const nodeModulesPath = path.join(scriptDir, "node_modules", pkgName);
  return exists(nodeModulesPath);
}


function ensurePackage(pkgName) {
  if (!isPackageInstalled(pkgName)) {
    installPackage(pkgName);
  }
}

function normalizeExePath(raw) {
  if (!raw) return "";
  return raw.trim().replace(/^\"|\"$/g, "");
}

function readCachedExePath() {
  if (!exists(exeCachePath)) return "";
  try {
    const cached = normalizeExePath(fs.readFileSync(exeCachePath, "utf8"));
    if (cached && exists(cached)) return cached;
  } catch {}
  return "";
}

function writeCachedExePath(exePath) {
  if (!exePath) return;
  try {
    fs.writeFileSync(exeCachePath, `${exePath}\n`, "utf8");
  } catch {}
}

function getCommonExeCandidates() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "";

  return [
    path.join(localAppData, "Programs", "OneView", "OneView.exe"),
    path.join(localAppData, "OneView", "OneView.exe"),
    path.join(programFiles, "OneView", "OneView.exe"),
    path.join(programFilesX86, "OneView", "OneView.exe"),
  ].filter(Boolean);
}

function findOneViewExeFast() {
  const envPath = normalizeExePath(process.env.ONEVIEW_PATH || "");
  if (envPath && exists(envPath)) return envPath;

  const cached = readCachedExePath();
  if (cached) return cached;

  for (const candidate of getCommonExeCandidates()) {
    if (exists(candidate)) {
      writeCachedExePath(candidate);
      return candidate;
    }
  }

  return "";
}

function findOneViewExe() {
  const fast = findOneViewExeFast();
  if (fast) return fast;

  const whereOutput = run("where", ["OneView.exe"]);
  if (whereOutput) {
    const first = normalizeExePath(whereOutput.split(/\r?\n/)[0] || "");
    if (first && exists(first)) {
      writeCachedExePath(first);
      return first;
    }
  }

  return "";
}

function updatePackageJson() {
  if (!exists(pkgPath)) {
    console.error("package.json not found next to setup-appstore.js");
    process.exit(1);
  }

  ensurePackage("concurrently");
  ensurePackage("wait-on");

  const oneViewExe = findOneViewExe();
  if (!oneViewExe) {
    console.error("OneView.exe not found.");
    console.error(
      "Install OneView first, or set ONEVIEW_PATH env var and rerun.",
    );
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};

  pkg.scripts.appstore =
    'concurrently "npm run dev" "wait-on http://localhost:5173 && node setup-appstore.js --run"';
  pkg.scripts["setup:appstore"] = "node setup-appstore.js";

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  writeCachedExePath(oneViewExe);

  console.log("Updated package.json scripts.appstore");
  console.log(`Detected OneView path: ${oneViewExe}`);
  console.log("Run: npm run appstore");
}

function launchOneView({ attached = false } = {}) {
  const oneViewExe = findOneViewExeFast() || findOneViewExe();
  if (!oneViewExe) {
    console.error("OneView.exe not found.");
    console.error("Set ONEVIEW_PATH env var or install OneView.");
    process.exit(1);
  }

  writeCachedExePath(oneViewExe);
  console.log(`Launching OneView from: ${oneViewExe}`);
  console.log(`Using dev URL: ${DEV_URL}`);

  const child = spawn(oneViewExe, [`--dev-url=${DEV_URL}`], {
    detached: !attached,
    stdio: attached ? "inherit" : "ignore",
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("Failed to launch OneView:", err.message || err);
    process.exit(1);
  });

  if (!attached) child.unref();
  return child;
}

if (process.argv.includes("--run")) {
  const oneView = launchOneView({ attached: true });

  const stop = () => {
    try {
      if (!oneView.killed) {
        oneView.kill();
      }
    } catch {}
  };

  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });

  oneView.on("close", (code) => {
    process.exit(code ?? 0);
  });
} else {
  updatePackageJson();
}
