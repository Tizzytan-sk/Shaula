#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function usage() {
  return [
    "Usage: node scripts/release-acceptance-win.mjs [options]",
    "",
    "Options:",
    "  --artifact <exe>      NSIS installer path. Defaults to dist/Shaula.Agent.Setup-<version>-x64.exe.",
    "  --unpacked <exe>      Unpacked app exe path. Defaults to dist/win-unpacked/Shaula Agent.exe.",
    "  --install             Run the NSIS installer silently into a temp/user-supplied directory.",
    "  --install-dir <dir>   Install directory used with --install.",
    "  --state-dir <dir>     Isolated APPDATA/LOCALAPPDATA/USERPROFILE root.",
    "  --keep-install        Do not run uninstaller or remove install-dir after --install.",
    "  --dry-run             Print the acceptance plan without launching anything.",
    "  --help                Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    install: false,
    keepInstall: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--install") out.install = true;
    else if (arg === "--keep-install") out.keepInstall = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--artifact") out.artifact = argv[++i];
    else if (arg === "--unpacked") out.unpacked = argv[++i];
    else if (arg === "--install-dir") out.installDir = argv[++i];
    else if (arg === "--state-dir") out.stateDir = argv[++i];
    else throw new Error(`unknown option: ${arg}`);
  }
  return out;
}

function defaultInstallerPath() {
  return path.join(root, "dist", `Shaula.Agent.Setup-${pkg.version}-x64.exe`);
}

function defaultUnpackedExePath() {
  return path.join(root, "dist", "win-unpacked", "Shaula Agent.exe");
}

function logStep(message) {
  console.log(`[release-acceptance] ${message}`);
}

function assertFile(file, label) {
  if (!existsSync(file)) {
    throw new Error(`${label} not found: ${file}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttpOk(url, timeoutMs = 45000) {
  return waitForHttpStatus(
    url,
    timeoutMs,
    (statusCode) => statusCode >= 200 && statusCode < 300
  );
}

async function waitForAnyHttpResponse(url, timeoutMs = 45000) {
  return waitForHttpStatus(url, timeoutMs, () => true);
}

async function waitForHttpStatus(url, timeoutMs, acceptStatus) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode != null && acceptStatus(res.statusCode));
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1200, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(300);
  }
  return false;
}

async function waitForWindowProbe(
  probeFile,
  base,
  {
    timeoutMs = 30000,
    expectedPath = "/",
    requiredSelector = "appShell",
    expectedHydrationMarker = "app",
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (existsSync(probeFile)) {
      try {
        last = JSON.parse(readFileSync(probeFile, "utf8"));
        const url = typeof last.url === "string" ? last.url : "";
        const bodyTextLength =
          typeof last.bodyTextLength === "number" ? last.bodyTextLength : 0;
        const diagnosticsCount =
          typeof last.diagnosticsCount === "number" ? last.diagnosticsCount : 0;
        const nextScripts =
          typeof last.staticResources?.nextScripts === "number"
            ? last.staticResources.nextScripts
            : 0;
        const loadedNextScripts =
          typeof last.staticResources?.loadedNextScripts === "number"
            ? last.staticResources.loadedNextScripts
            : 0;
        const stylesheets =
          typeof last.staticResources?.stylesheets === "number"
            ? last.staticResources.stylesheets
            : 0;
        const selectorReady = last.selectors?.[requiredSelector] === true;
        if (
          last.visible === true &&
          url.startsWith(base) &&
          last.readyState === "complete" &&
          last.locationPath === expectedPath &&
          last.hydrationMarker === expectedHydrationMarker &&
          bodyTextLength > 0 &&
          selectorReady &&
          nextScripts > 0 &&
          loadedNextScripts > 0 &&
          stylesheets > 0 &&
          diagnosticsCount === 0 &&
          !last.error
        ) {
          return last;
        }
      } catch {
        // Keep polling until the writer completes the JSON file.
      }
    }
    await sleep(300);
  }
  throw new Error(
    `window probe did not show a ready Electron window (${expectedPath}): ${JSON.stringify(last).slice(0, 800)}`
  );
}

function readJsonFile(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const done = (exited) => {
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("error", onError);
      resolve(exited);
    };
    const onExit = () => done(true);
    const onError = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function processExists(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

async function waitForPidGone(pid, timeoutMs) {
  if (!pid) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await sleep(250);
  }
  return !processExists(pid);
}

async function waitForServerProbeStarted(probeFile, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = readJsonFile(probeFile);
    if (last?.status === "started" && Number.isInteger(last.pid) && last.pid > 0) {
      return last;
    }
    await sleep(250);
  }
  throw new Error(
    `server probe did not report a started child pid: ${JSON.stringify(last).slice(0, 500)}`
  );
}

async function requestJson(base, localSecret, pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-shaula-local-secret": localSecret,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${pathname} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`${pathname} failed (${response.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function runInstaller(installer, installDir) {
  logStep(`installing NSIS artifact into ${installDir}`);
  mkdirSync(installDir, { recursive: true });
  const result = spawnSync(installer, ["/S", `/D=${installDir}`], {
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.status !== 0) {
    throw new Error(`installer exited with ${result.status ?? "unknown"}`);
  }
  const exe = path.join(installDir, "Shaula Agent.exe");
  assertFile(exe, "installed app executable");
  return exe;
}

function launchApp(exe, env) {
  logStep(`launching ${exe}`);
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopApp(child, base, serverProbeFile) {
  if (!child || child.killed) return;
  logStep("quitting app process");
  const serverProbe = readJsonFile(serverProbeFile);
  const serverPid =
    typeof serverProbe?.pid === "number" && serverProbe.pid > 0
      ? serverProbe.pid
      : null;
  child.kill("SIGTERM");
  const [childExited, down, serverGone] = await Promise.all([
    waitForChildExit(child, 3000),
    waitForAnyHttpResponse(`${base}/api/health`, 3000).then((ok) => !ok),
    waitForPidGone(serverPid, 3000),
  ]);
  if (childExited && down && serverGone) return;
  const parentAlive = child.pid ? processExists(child.pid) : false;
  if (process.platform === "win32" && child.pid && parentAlive) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else if (parentAlive) {
    child.kill("SIGKILL");
  }
  const [forcedChildExited, forcedDown, forcedServerGone] = await Promise.all([
    waitForChildExit(child, 5000),
    waitForAnyHttpResponse(`${base}/api/health`, 5000).then((ok) => !ok),
    waitForPidGone(serverPid, 5000),
  ]);
  const failures = [];
  if (!forcedChildExited) failures.push("Electron process still alive");
  if (!forcedDown) failures.push("health endpoint still reachable");
  if (!forcedServerGone) failures.push(`server pid ${serverPid} still alive`);
  if (failures.length > 0) {
    throw new Error(`app did not stop cleanly: ${failures.join("; ")}`);
  }
}

function uninstall(installDir) {
  const uninstaller = path.join(installDir, "Uninstall Shaula Agent.exe");
  if (!existsSync(uninstaller)) return;
  logStep("running uninstaller");
  spawnSync(uninstaller, ["/S"], { stdio: "inherit", windowsHide: false });
}

async function removeDirWithRetries(dir, label, attempts = 20) {
  if (!dir || !existsSync(dir)) return;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      if (!existsSync(dir)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  const message =
    lastError instanceof Error ? lastError.message : "directory still exists";
  throw new Error(`failed to remove ${label}: ${message}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const installer = path.resolve(args.artifact ?? defaultInstallerPath());
  const unpackedExe = path.resolve(args.unpacked ?? defaultUnpackedExePath());
  const installDir = path.resolve(
    args.installDir ??
      path.join(os.tmpdir(), `shaula-release-acceptance-${Date.now()}`)
  );
  const stateDir = path.resolve(
    args.stateDir ??
      (args.dryRun
        ? path.join(
            os.tmpdir(),
            `shaula-release-state-${randomBytes(3).toString("hex")}`
          )
        : mkdtempSync(path.join(os.tmpdir(), "shaula-release-state-")))
  );
  const windowProbeFile = path.join(stateDir, "window-probe.json");
  const settingsWindowProbeFile = path.join(stateDir, "settings-window-probe.json");
  const teamWindowProbeFile = path.join(stateDir, "team-window-probe.json");
  const serverProbeFile = path.join(stateDir, "server-probe.json");
  const plan = {
    platform: process.platform,
    installer,
    unpackedExe,
    install: args.install,
    installDir: args.install ? installDir : null,
    stateDir,
    windowProbeFile,
    settingsWindowProbeFile,
    teamWindowProbeFile,
    serverProbeFile,
  };
  if (args.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (process.platform !== "win32") {
    throw new Error("Windows release acceptance must run on win32. Use --dry-run to inspect the plan elsewhere.");
  }

  let appExe = unpackedExe;
  let installed = false;
  if (args.install) {
    assertFile(installer, "Windows NSIS installer");
    appExe = runInstaller(installer, installDir);
    installed = true;
  } else {
    assertFile(appExe, "unpacked app executable");
  }

  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const localSecret = randomBytes(32).toString("base64url");
  const appData = path.join(stateDir, "AppData", "Roaming");
  const localAppData = path.join(stateDir, "AppData", "Local");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });

  const env = {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    USERPROFILE: stateDir,
    ELECTRON_DISABLE_PET: "1",
    SHAULA_ACCEPTANCE_PORT: String(port),
    SHAULA_LOCAL_SECRET: localSecret,
    SHAULA_WEB_ROOT: root,
    SHAULA_PREFER_ENV: "1",
    SHAULA_ACCEPTANCE_WINDOW_PROBE: windowProbeFile,
    SHAULA_ACCEPTANCE_SETTINGS_WINDOW_PROBE: settingsWindowProbeFile,
    SHAULA_ACCEPTANCE_TEAM_WINDOW_PROBE: teamWindowProbeFile,
    SHAULA_ACCEPTANCE_SERVER_PROBE: serverProbeFile,
  };

  const child = launchApp(appExe, env);
  try {
    const ready = await waitForHttpOk(`${base}/api/health`);
    if (!ready) throw new Error(`health endpoint did not become ready at ${base}`);
    logStep(`health ready at ${base}`);
    const serverProbe = await waitForServerProbeStarted(serverProbeFile);
    logStep(`standalone server pid ${serverProbe.pid}`);
    const windowProbe = await waitForWindowProbe(windowProbeFile, base);
    logStep(
      `main window ready (${windowProbe.bodyTextLength} chars, ${windowProbe.staticResources.nextScripts} Next scripts at ${windowProbe.url})`
    );

    await requestJson(base, localSecret, "/api/providers", { method: "GET" });
    await requestJson(base, localSecret, "/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        provider: "local-coding-assistant",
        modelId: "local-coding-assistant",
        cwd: root,
      }),
    });
    logStep("created local-coding-assistant session");

    const settingsOk = await waitForHttpOk(`${base}/settings`, 10000);
    if (!settingsOk) throw new Error("settings route did not respond");
    const settingsProbe = await waitForWindowProbe(
      settingsWindowProbeFile,
      base,
      {
        timeoutMs: 10000,
        expectedPath: "/settings",
        requiredSelector: "settingsPage",
        expectedHydrationMarker: "settings",
      }
    );
    logStep(
      `settings route rendered in Electron (${settingsProbe.bodyTextLength} chars at ${settingsProbe.url})`
    );
    const teamProbe = await waitForWindowProbe(
      teamWindowProbeFile,
      base,
      {
        timeoutMs: 15000,
        expectedPath: "/",
        requiredSelector: "workbenchTeamPlan",
        expectedHydrationMarker: "app",
      }
    );
    logStep(
      `Team Plan rendered in Electron (${teamProbe.bodyTextLength} chars at ${teamProbe.url})`
    );
  } finally {
    await stopApp(child, base, serverProbeFile);
    if (installed && !args.keepInstall) uninstall(installDir);
    if (!args.keepInstall) {
      await removeDirWithRetries(stateDir, "acceptance state dir");
      if (installed) {
        await removeDirWithRetries(installDir, "temporary install dir");
      }
    }
  }
  logStep("Windows release acceptance passed");
}

main().catch((error) => {
  console.error(`[release-acceptance] FAILED: ${error.message}`);
  process.exit(1);
});
