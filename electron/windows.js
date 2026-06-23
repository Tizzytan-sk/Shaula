const { BrowserWindow, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

async function writeAcceptanceWindowProbe(win, options = {}) {
  const probeFile = options.probeFile || process.env.SHAULA_ACCEPTANCE_WINDOW_PROBE;
  if (!probeFile || !win || win.isDestroyed()) return;
  let snapshot = {};
  let error = null;
  try {
    snapshot = await win.webContents.executeJavaScript(
      `({
        readyState: document.readyState,
        locationPath: window.location.pathname,
        hydrationMarker: document.documentElement?.dataset?.shaulaHydrated || "",
        title: document.title || "",
        bodyText: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 1000),
        selectors: {
          appShell: Boolean(document.querySelector("[data-testid='shaula-app-shell']")),
          composerReadiness: Boolean(document.querySelector("[data-testid='composer-readiness']")),
          workbenchOverview: Boolean(document.querySelector("[data-testid='workbench-overview']")),
          workbenchTeamLauncher: Boolean(document.querySelector("[data-testid='workbench-launch-Team']")),
          workbenchTeamPlan: Boolean(document.querySelector("[data-testid='workbench-team-plan']")),
          settingsPage: Boolean(document.querySelector(".settings-page"))
        },
        staticResources: {
          nextScripts: Array.from(document.scripts || []).filter((item) => (item.src || "").includes("/_next/")).length,
          stylesheets: Array.from(document.styleSheets || []).length,
          loadedNextScripts: performance.getEntriesByType("resource").filter((item) =>
            item.initiatorType === "script" &&
            item.name.includes("/_next/static/") &&
            (item.responseStatus === 200 || item.transferSize > 0 || item.decodedBodySize > 0)
          ).length,
          loadedNextStyles: performance.getEntriesByType("resource").filter((item) =>
            (item.initiatorType === "link" || item.initiatorType === "css") &&
            item.name.includes("/_next/static/") &&
            (item.responseStatus === 200 || item.transferSize > 0 || item.decodedBodySize > 0)
          ).length
        }
      })`,
      true
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const bodyText = typeof snapshot?.bodyText === "string" ? snapshot.bodyText : "";
  const title = typeof snapshot?.title === "string" ? snapshot.title : "";
  const diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : [];
  const payload = {
    kind: "shaula_acceptance_window_probe",
    visible: win.isVisible(),
    focused: win.isFocused(),
    minimized: win.isMinimized(),
    destroyed: win.isDestroyed(),
    url: win.webContents.getURL(),
    expectedPath: options.expectedPath || null,
    readyState: typeof snapshot?.readyState === "string" ? snapshot.readyState : "",
    locationPath: typeof snapshot?.locationPath === "string" ? snapshot.locationPath : "",
    hydrationMarker:
      typeof snapshot?.hydrationMarker === "string" ? snapshot.hydrationMarker : "",
    title,
    bodyTextLength: bodyText.length,
    bodyPreview: bodyText.slice(0, 200),
    selectors: snapshot?.selectors || {},
    staticResources: snapshot?.staticResources || {},
    diagnostics,
    diagnosticsCount: diagnostics.length,
    bounds: win.getBounds(),
    error,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(probeFile), { recursive: true });
    fs.writeFileSync(probeFile, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn("[electron] acceptance window probe failed:", err.message);
  }
}

async function writeAcceptanceTeamWindowProbe(win, options = {}) {
  if (!options.probeFile || !win || win.isDestroyed()) return;
  let interactionError = null;
  try {
    await win.webContents.executeJavaScript(
      `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const click = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return false;
          node.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
          }));
          return true;
        };
        click("[aria-label='Workbench 面板']");
        await sleep(150);
        if (!document.querySelector("[data-testid='workbench-launch-Team']")) {
          click("[data-testid='workbench-tab-home']");
          await sleep(100);
        }
        if (!click("[data-testid='workbench-launch-Team']")) {
          click("[data-testid='workbench-create-tab']");
          await sleep(100);
          click("[data-testid='workbench-create-Team']");
        }
        await sleep(250);
        return Boolean(document.querySelector("[data-testid='workbench-team-plan']"));
      })()`,
      true
    );
  } catch (err) {
    interactionError = err instanceof Error ? err.message : String(err);
  }
  await writeAcceptanceWindowProbe(win, {
    ...options,
    diagnostics: [
      ...(Array.isArray(options.diagnostics) ? options.diagnostics : []),
      ...(interactionError
        ? [{ kind: "team-probe-interaction", details: interactionError }]
        : []),
    ],
  });
}

function scheduleAcceptanceWindowProbe(win, options = {}) {
  for (const delayMs of [250, 1000, 2000]) {
    setTimeout(() => {
      writeAcceptanceWindowProbe(win, options).catch((err) => {
        console.warn(
          "[electron] acceptance window probe retry failed:",
          err instanceof Error ? err.message : String(err)
        );
      });
    }, delayMs).unref();
  }
}

function createWindowController({
  app,
  shell,
  dev,
  devUrl,
  getApiBase,
  startStandaloneServer,
  waitForHttp,
  checkOnStartup,
  updateTrayMenu,
}) {
  let mainWin = null;
  let settingsWin = null;
  let petWin = null;
  const acceptanceDiagnostics = [];

  function recordAcceptanceDiagnostic(kind, details) {
    if (
      !process.env.SHAULA_ACCEPTANCE_WINDOW_PROBE &&
      !process.env.SHAULA_ACCEPTANCE_SETTINGS_WINDOW_PROBE
    ) {
      return;
    }
    acceptanceDiagnostics.push({
      kind,
      details,
      createdAt: new Date().toISOString(),
    });
    if (acceptanceDiagnostics.length > 50) acceptanceDiagnostics.shift();
  }

  function getPrimaryMainWindow() {
    if (mainWin && !mainWin.isDestroyed()) return mainWin;
    return BrowserWindow.getAllWindows().find(
      (w) =>
        w !== petWin &&
        (settingsWin ? w !== settingsWin : true) &&
        !w.isDestroyed()
    );
  }

  function focusWindow(win) {
    if (!win || win.isDestroyed()) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.moveTop();
    app.focus({ steal: true });
    win.focus();
    return true;
  }

  function attachWindowDiagnostics(win, label) {
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        recordAcceptanceDiagnostic("did-fail-load", {
          label,
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
        if (!dev) return;
        console.warn(
          `[electron:${label}:did-fail-load] ${errorCode} ${errorDescription} ${validatedURL} mainFrame=${isMainFrame}`
        );
      }
    );
    win.webContents.on("render-process-gone", (_event, details) => {
      recordAcceptanceDiagnostic("render-process-gone", { label, details });
      if (!dev) return;
      console.warn(`[electron:${label}:render-process-gone]`, details);
    });
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 3) return;
      recordAcceptanceDiagnostic("console-message", {
        label,
        level,
        message: String(message).slice(0, 500),
        line,
        sourceId,
      });
    });
  }

  async function openMainWindow() {
    const win = getPrimaryMainWindow();
    if (focusWindow(win)) return win;
    return createWindow();
  }

  async function createWindow() {
    if (mainWin && !mainWin.isDestroyed()) {
      focusWindow(mainWin);
      return mainWin;
    }
    mainWin = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 960,
      minHeight: 680,
      title: "Shaula Agent",
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        spellcheck: false,
        backgroundThrottling: false,
        webviewTag: true,
      },
      backgroundColor: "#ffffff",
    });

    const win = mainWin;
    attachWindowDiagnostics(win, "main");

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });

    const url = dev
      ? devUrl
      : getApiBase() || await startStandaloneServer();
    console.log(`[electron] loading ${url}`);

    if (dev) {
      const ok = await waitForHttp(`${url}/api/health`, 30000);
      if (!ok) {
        console.error(
          `[electron] dev server not reachable at ${url}; 请先 npm run dev`
        );
      }
    }

    win.once("ready-to-show", () => {
      win.show();
      win.focus();
    });

    await win.loadURL(url);
    console.log(`[electron] main window loaded ${url}`);
    if (!dev) {
      checkOnStartup();
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.center();
    win.show();
    win.moveTop();
    app.focus({ steal: true });
    win.focus();
    await writeAcceptanceWindowProbe(win, {
      expectedPath: "/",
      diagnostics: acceptanceDiagnostics,
    });
    scheduleAcceptanceWindowProbe(win, {
      expectedPath: "/",
      diagnostics: acceptanceDiagnostics,
    });
    const teamProbeFile = process.env.SHAULA_ACCEPTANCE_TEAM_WINDOW_PROBE;
    if (teamProbeFile) {
      setTimeout(async () => {
        try {
          await writeAcceptanceTeamWindowProbe(win, {
            probeFile: teamProbeFile,
            expectedPath: "/",
            diagnostics: acceptanceDiagnostics,
          });
        } catch (err) {
          console.warn(
            "[electron] acceptance Team window probe failed:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }, 650).unref();
    }
    const settingsProbeFile = process.env.SHAULA_ACCEPTANCE_SETTINGS_WINDOW_PROBE;
    if (settingsProbeFile) {
      setTimeout(async () => {
        try {
          const settings = await openSettingsWindow();
          await writeAcceptanceWindowProbe(settings, {
            probeFile: settingsProbeFile,
            expectedPath: "/settings",
            diagnostics: acceptanceDiagnostics,
          });
          scheduleAcceptanceWindowProbe(settings, {
            probeFile: settingsProbeFile,
            expectedPath: "/settings",
            diagnostics: acceptanceDiagnostics,
          });
        } catch (err) {
          console.warn(
            "[electron] acceptance settings window probe failed:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }, 2500).unref();
    }
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setVisibleOnAllWorkspaces(false);
      }
    }, 2000).unref();
    win.on("closed", () => {
      if (mainWin === win) mainWin = null;
      updateTrayMenu();
    });
    return win;
  }

  async function openSettingsWindow() {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.close();
      settingsWin = null;
    }
    const win = await openMainWindow();
    const base = getApiBase() || devUrl;
    const settingsUrl = `${base}/settings`;
    if (!win.webContents.getURL().startsWith(settingsUrl)) {
      await win.loadURL(settingsUrl);
    }
    focusWindow(win);
    return win;
  }

  async function createPetWindow(baseUrl) {
    if (petWin && !petWin.isDestroyed()) return petWin;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    petWin = new BrowserWindow({
      width: 320,
      height: 400,
      x: width - 340,
      y: height - 420,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    petWin.setIgnoreMouseEvents(true, { forward: true });
    attachWindowDiagnostics(petWin, "pet");
    petWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    petWin.on("closed", () => {
      petWin = null;
      updateTrayMenu();
    });
    petWin.on("blur", () => {
      if (petWin && !petWin.isDestroyed()) {
        petWin.webContents.send("pet:window-blur");
      }
    });

    await petWin.loadURL(`${baseUrl}/pet`);
    updateTrayMenu();
    return petWin;
  }

  return {
    getMainWindow: () => mainWin,
    getPetWindow: () => petWin,
    getPrimaryMainWindow,
    focusWindow,
    openMainWindow,
    createWindow,
    openSettingsWindow,
    createPetWindow,
  };
}

module.exports = {
  createWindowController,
};
