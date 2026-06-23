/**
 * Electron 主进程入口。
 *
 * 两种模式：
 *  - dev:  ELECTRON_DEV=1，期望外部已经 `npm run dev` 起好 :3000，直接 loadURL
 *  - prod: 默认模式，主进程 fork .next/standalone/server.js 监听随机端口
 *
 * key 透传策略：把主进程 process.env 整个传给 child（含 MINIMAX_CN_API_KEY、OPENAI_API_KEY 等）。
 * 等 D3 做设置窗 + keytar 后，再改成"按需注入"。
 *
 * SHAULA_WEB_ROOT：文件 API 的根护栏，默认设成 home 目录，避免误删别人文件。
 */
const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Menu,
} = require("electron");
const crypto = require("node:crypto");
const settingsModule = require("./settings");
const updaterModule = require("./updater");
const coreIpc = require("./core-ipc");
const petIpc = require("./pet-ipc");
const serverLifecycle = require("./server-lifecycle");
const settingsIpc = require("./settings-ipc");
const trayModule = require("./tray");
const webviewPocIpc = require("./webview-poc-ipc");
const windowsModule = require("./windows");

const DEV = process.env.ELECTRON_DEV === "1";
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:3000";
const DISABLE_PET_WINDOW = process.env.ELECTRON_DISABLE_PET === "1";

let localSessionSecret =
  process.env.SHAULA_LOCAL_SECRET || crypto.randomBytes(32).toString("base64url");
let localSecretHeaderHookInstalled = false;
/** macOS menu bar / tray icon 必须保留强引用，否则会被 GC 回收。 */
let trayController = null;
let serverController = null;
let windowController = null;

function getPrimaryMainWindow() {
  return getWindowController().getPrimaryMainWindow();
}

function focusWindow(win) {
  return getWindowController().focusWindow(win);
}

function installLocalSecretHeaderHook() {
  if (localSecretHeaderHookInstalled) return;
  localSecretHeaderHookInstalled = true;
  const ses = require("electron").session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const target = new URL(details.url);
      const bases = [getApiBase(), DEV_URL]
        .filter(Boolean)
        .map((raw) => new URL(raw));
      const sameAppOrigin = bases.some(
        (base) =>
          target.protocol === base.protocol &&
          target.hostname === base.hostname &&
          target.port === base.port
      );
      if (sameAppOrigin) {
        details.requestHeaders["x-shaula-local-secret"] = localSessionSecret;
      }
    } catch {
      // leave headers untouched
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

async function openMainWindow() {
  return getWindowController().openMainWindow();
}

function getServerController() {
  if (!serverController) {
    serverController = serverLifecycle.createServerLifecycle({
      app,
      dev: DEV,
      localSessionSecret,
      getAllWindows: () => BrowserWindow.getAllWindows(),
    });
  }
  return serverController;
}

function getApiBase() {
  return getServerController().getApiBase();
}

function startStandaloneServer() {
  return getServerController().startStandaloneServer();
}

function reloadStandaloneServerFromSettings() {
  return getServerController().reloadFromSettings();
}

function waitForHttp(url, timeoutMs) {
  return serverLifecycle.waitForHttp(url, timeoutMs);
}

function getWindowController() {
  if (!windowController) {
    windowController = windowsModule.createWindowController({
      app,
      shell,
      dev: DEV,
      devUrl: DEV_URL,
      getApiBase,
      startStandaloneServer,
      waitForHttp,
      checkOnStartup: () => updaterModule.checkOnStartup(),
      updateTrayMenu,
    });
  }
  return windowController;
}

function createWindow() {
  return getWindowController().createWindow();
}

function openSettingsWindow() {
  return getWindowController().openSettingsWindow();
}

function createPetWindow(baseUrl) {
  return getWindowController().createPetWindow(baseUrl);
}

function getPetWindow() {
  return getWindowController().getPetWindow();
}

function getTrayController() {
  if (!trayController) {
    trayController = trayModule.createTrayController({
      app,
      dev: DEV,
      devUrl: DEV_URL,
      disablePetWindow: DISABLE_PET_WINDOW,
      getApiBase,
      getPetWindow,
      createPetWindow,
      openMainWindow,
      openSettingsWindow,
      checkForUpdates: (opts) => updaterModule.checkForUpdates(opts),
    });
  }
  return trayController;
}

function updateTrayMenu() {
  getTrayController().updateTrayMenu();
}

function createTray() {
  return getTrayController().createTray();
}

/**
 * 注册 IPC handlers。
 * 命名约定：domain:action（例如 "shell:openExternal"）
 */
function registerIpc() {
  webviewPocIpc.registerWebviewPocIpc(ipcMain);
  updaterModule.registerUpdateIpc({
    app,
    ipcMain,
    shell,
    getWindow: () => getWindowController().getMainWindow(),
  });

  coreIpc.registerCoreIpc({
    app,
    ipcMain,
    getApiBase,
    getLocalSecret: () => localSessionSecret,
    devUrl: DEV_URL,
    isDev: DEV,
  });

  settingsIpc.registerSettingsIpc({
    app,
    ipcMain,
    openSettingsWindow,
    reloadServer: reloadStandaloneServerFromSettings,
  });

  petIpc.registerPetIpc({
    ipcMain,
    app,
    getPetWindow,
    getPrimaryMainWindow,
    focusWindow,
    openMainWindow,
    openSettingsWindow,
    updateTrayMenu,
  });
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "设置…",
                accelerator: "Cmd+,",
                click: () => void openSettingsWindow(),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(isMac
          ? []
          : [
              {
                label: "Settings…",
                accelerator: "Ctrl+,",
                click: () => void openSettingsWindow(),
              },
              { type: "separator" },
            ]),
        { role: isMac ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: () =>
            void shell.openExternal(
              "https://github.com/earendil-works/pi-coding-agent"
            ),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  registerIpc();
  installLocalSecretHeaderHook();
  buildAppMenu();
  createTray();

  // 一次性 env → keytar 迁移（首次启动若 keytar 空且 env 里有 key，自动入库）
  try {
    const migrated = await settingsModule.migrateFromEnvIfNeeded(app);
    if (migrated.length > 0) {
      console.log(
        `[electron] migrated env keys to keytar: ${migrated.join(", ")}`
      );
    }
  } catch (e) {
    console.warn("[electron] env→keytar migration failed:", e.message);
  }

  try {
    await createWindow();
  } catch (e) {
    console.error("[electron] failed to start:", e);
    app.quit();
  }

  // 启动宠物窗口；验收/自动化可通过 env 关闭，避免透明悬浮窗干扰可访问性遍历。
  if (!DISABLE_PET_WINDOW) {
    const petBase = getApiBase() || DEV_URL;
    try {
      await createPetWindow(petBase);
    } catch (e) {
      console.warn("[electron] pet window failed to start:", e.message);
    }
  }

  app.on("activate", () => {
    void openMainWindow();
  });
});

/** 同步 best-effort kill；多次调用安全 */
function killServerChild(reason) {
  if (!serverController) return;
  serverController.killServerChild(reason);
}

app.on("before-quit", () => {
  app.isQuitting = true;
  killServerChild("before-quit");
});

app.on("will-quit", () => killServerChild("will-quit"));

// 同步阶段最后一次机会
process.on("exit", () => {
  serverController?.killOnProcessExit();
});

// Electron 主进程被信号杀掉时也尝试带走 child
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => {
    killServerChild(`main got ${sig}`);
    // 走标准 quit 流程，触发 before-quit 等
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
