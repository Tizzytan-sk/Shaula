const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const settingsModule = require("./settings");

function envValue(primaryName) {
  const primary = process.env[primaryName]?.trim();
  return primary || undefined;
}

function writeAcceptanceServerProbe(payload) {
  const probeFile = process.env.SHAULA_ACCEPTANCE_SERVER_PROBE;
  if (!probeFile) return;
  try {
    fs.mkdirSync(path.dirname(probeFile), { recursive: true });
    fs.writeFileSync(
      probeFile,
      JSON.stringify(
        {
          kind: "shaula_acceptance_server_probe",
          ...payload,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.warn("[electron] acceptance server probe failed:", err.message);
  }
}

function asarUnpackedPath(p) {
  return p.includes(`app.asar${path.sep}`)
    ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    : p;
}

function standaloneServerPath() {
  const root = path.resolve(__dirname, "..");
  return path.join(root, ".next", "standalone", "server.js");
}

function getFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function isTailscaleIPv4(ip) {
  const parts = String(ip).split(".").map((x) => Number(x));
  return (
    parts.length === 4 &&
    parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) &&
    parts[0] === 100 &&
    parts[1] >= 64 &&
    parts[1] <= 127
  );
}

function bindHostForRemoteMode(mode) {
  if (mode === "off") return "127.0.0.1";
  if (mode === "lan") return "0.0.0.0";
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (
        !item.internal &&
        item.family === "IPv4" &&
        isTailscaleIPv4(item.address)
      ) {
        return item.address;
      }
    }
  }
  return "127.0.0.1";
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode != null && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function createServerLifecycle({ app, dev, localSessionSecret, getAllWindows }) {
  let serverChild = null;
  let apiBase = null;
  const expectedServerExits = new WeakSet();

  function loadRemoteAccessSettings() {
    const remote = settingsModule.loadSettings(app).remoteAccess || {};
    const mode =
      remote.mode === "vpn" || remote.mode === "lan" ? remote.mode : "off";
    return {
      mode,
      port:
        Number.isInteger(remote.port) && remote.port > 0
          ? remote.port
          : 37373,
    };
  }

  async function startStandaloneServer() {
    const startedAt = Date.now();
    const remote = loadRemoteAccessSettings();
    const acceptancePort = Number(process.env.SHAULA_ACCEPTANCE_PORT || 0);
    const useAcceptancePort =
      Number.isInteger(acceptancePort) &&
      acceptancePort > 0 &&
      acceptancePort < 65536;
    const bindHost = useAcceptancePort
      ? "127.0.0.1"
      : bindHostForRemoteMode(remote.mode);
    const port = useAcceptancePort
      ? acceptancePort
      : remote.mode === "off"
        ? await getFreePort(bindHost)
        : remote.port;
    const serverFile = standaloneServerPath();
    const wrapperFile = asarUnpackedPath(
      path.join(__dirname, "server-wrapper.js")
    );
    console.log(
      `[electron] forking standalone server via wrapper: ${serverFile} on ${bindHost}:${port} remote=${remote.mode} (wrapper=${wrapperFile})`
    );

    const keytarEnv = await settingsModule.buildEnvFromKeytar().catch((e) => {
      console.warn("[electron] buildEnvFromKeytar failed:", e.message);
      return {};
    });
    const preferEnv = process.env.SHAULA_PREFER_ENV === "1";
    const mergedEnv = { ...process.env };

    if (preferEnv) {
      for (const [k, v] of Object.entries(keytarEnv)) {
        if (mergedEnv[k] === undefined || mergedEnv[k] === "") mergedEnv[k] = v;
      }
    } else {
      const knownEnvNames = new Set(
        Object.values(settingsModule.PROVIDER_ENV_MAP).flat()
      );
      for (const name of knownEnvNames) {
        delete mergedEnv[name];
      }
      for (const [k, v] of Object.entries(keytarEnv)) {
        mergedEnv[k] = v;
      }
    }

    mergedEnv.PORT = String(port);
    mergedEnv.HOSTNAME = bindHost;
    mergedEnv.SHAULA_WEB_ROOT = envValue("SHAULA_WEB_ROOT") || os.homedir();
    mergedEnv.SHAULA_SETTINGS_FILE = settingsModule.settingsFile(app);
    mergedEnv.SHAULA_LOCAL_SECRET = localSessionSecret;
    mergedEnv.NODE_ENV = "production";
    mergedEnv.SHAULA_SERVER_ENTRY = serverFile;
    mergedEnv.SHAULA_PARENT_PID = String(process.pid);

    const keysFromKeytar = Object.keys(keytarEnv);
    console.log(
      `[electron] env strategy: ${preferEnv ? "env-wins (dev)" : "keytar-wins (prod)"}; keytar provides ${keysFromKeytar.length}: ${keysFromKeytar.join(", ") || "(none)"}`
    );

    if (process.env.SHAULA_DEBUG_ENV === "1") {
      const parentKeys = new Set(Object.keys(process.env));
      const childKeys = new Set(Object.keys(mergedEnv));
      const onlyInParent = [...parentKeys].filter((k) => !childKeys.has(k)).sort();
      const onlyInChild = [...childKeys].filter((k) => !parentKeys.has(k)).sort();
      console.log(
        `[electron] env diff: parent=${parentKeys.size}, child=${childKeys.size}`
      );
      console.log(
        `[electron] only-in-parent (${onlyInParent.length}):`,
        onlyInParent
      );
      console.log(
        `[electron] only-in-child  (${onlyInChild.length}):`,
        onlyInChild
      );
    }

    serverChild = fork(wrapperFile, [], {
      env: mergedEnv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    const child = serverChild;
    writeAcceptanceServerProbe({
      status: "started",
      pid: child.pid,
      apiBase: `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}`,
    });
    child.on("exit", (code, signal) => {
      console.log(`[electron] server exited code=${code} signal=${signal}`);
      const expectedExit = expectedServerExits.has(child);
      expectedServerExits.delete(child);
      writeAcceptanceServerProbe({
        status: "exited",
        pid: child.pid,
        code,
        signal,
        expectedExit,
      });
      if (serverChild === child) {
        serverChild = null;
      }
      if (!expectedExit && !app.isQuitting) {
        app.quit();
      }
    });

    const ipcReady = new Promise((resolve) => {
      const onMsg = (msg) => {
        if (msg && msg.type === "server-ready") {
          serverChild?.off?.("message", onMsg);
          resolve(true);
        }
      };
      serverChild.on("message", onMsg);
    });
    const ready = await Promise.race([
      ipcReady,
      waitForHttp(
        `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}/api/health`
      ),
    ]);
    if (!ready) {
      throw new Error(`standalone server failed to become ready on :${port}`);
    }
    apiBase = `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}`;
    console.log(
      `[electron] standalone server ready in ${Date.now() - startedAt}ms`
    );
    return apiBase;
  }

  function killServerChild(reason, options = {}) {
    if (!serverChild || serverChild.killed) return serverChild;
    const child = serverChild;
    if (options.expectedExit === true) {
      expectedServerExits.add(child);
    }
    writeAcceptanceServerProbe({
      status: "stopping",
      pid: child.pid,
      reason,
      expectedExit: options.expectedExit === true,
    });
    console.log(`[electron] killing standalone server (${reason})`);
    try {
      child.kill("SIGTERM");
    } catch (e) {
      console.warn("[electron] SIGTERM failed:", e);
    }
    const pid = child.pid;
    setTimeout(() => {
      if (pid) {
        try {
          process.kill(pid, 0);
          console.warn(
            `[electron] server pid=${pid} still alive after SIGTERM, SIGKILL`
          );
          process.kill(pid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }
    }, 500).unref();
    return child;
  }

  function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }
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

  async function reloadFromSettings() {
    if (dev) return { ok: true, dev: true };
    console.log("[electron] settings:reloadServer requested");
    const oldChild = killServerChild("reloadServer", { expectedExit: true });
    const exited = await waitForChildExit(oldChild, 3000);
    if (!exited) {
      throw new Error("standalone server did not exit before reload");
    }
    serverChild = null;
    apiBase = null;
    const newBase = await startStandaloneServer();
    for (const win of getAllWindows()) {
      try {
        await win.loadURL(newBase);
      } catch (e) {
        console.warn("[electron] reload window failed:", e.message);
      }
    }
    return { ok: true, base: newBase };
  }

  function killOnProcessExit() {
    if (serverChild && !serverChild.killed && serverChild.pid) {
      try {
        process.kill(serverChild.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }

  return {
    getApiBase: () => apiBase,
    startStandaloneServer,
    reloadFromSettings,
    killServerChild,
    killOnProcessExit,
  };
}

module.exports = {
  createServerLifecycle,
  waitForHttp,
};
