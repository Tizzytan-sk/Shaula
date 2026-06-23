const { Menu, screen } = require("electron");

function registerPetIpc({
  ipcMain,
  app,
  getPetWindow,
  getPrimaryMainWindow,
  focusWindow,
  openMainWindow,
  openSettingsWindow,
  updateTrayMenu,
}) {
  ipcMain.on("pet:state-from-main", (_event, state) => {
    const petWin = getPetWindow();
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send("pet:state", state);
    }
  });

  ipcMain.on("pet:focus-main", (_event, sessionId) => {
    const mainWin = getPrimaryMainWindow();
    if (focusWindow(mainWin) && sessionId) {
      mainWin.webContents.send("pet:switch-session", sessionId);
    }
  });

  ipcMain.on("pet:reconnect-session", (_event, sessionId) => {
    if (!sessionId) return;
    const mainWin = getPrimaryMainWindow();
    if (mainWin) {
      mainWin.webContents.send("pet:reconnect-session", sessionId);
    }
  });

  ipcMain.on("pet:set-visible", (_event, visible) => {
    const petWin = getPetWindow();
    if (!petWin || petWin.isDestroyed()) return;
    if (visible) petWin.show();
    else petWin.hide();
    updateTrayMenu();
  });

  ipcMain.on("pet:move", (_event, { x, y }) => {
    const petWin = getPetWindow();
    if (petWin && !petWin.isDestroyed()) {
      petWin.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle("pet:get-work-area", () => {
    const petWin = getPetWindow();
    if (!petWin || petWin.isDestroyed()) return null;
    const [winX, winY] = petWin.getPosition();
    const [winW, winH] = petWin.getSize();
    const centerX = winX + winW / 2;
    const centerY = winY + winH / 2;
    const display = screen.getDisplayNearestPoint({
      x: Math.round(centerX),
      y: Math.round(centerY),
    });
    const wa = display.workArea;
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  });

  ipcMain.on("pet:set-ignore-mouse", (_event, ignore) => {
    const petWin = getPetWindow();
    if (petWin && !petWin.isDestroyed()) {
      petWin.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  /**
   * payload: { hasSession, streaming, sessions: [{ id, name, focused }] }
   */
  ipcMain.on("pet:show-context-menu", (_event, payload = {}) => {
    const petWin = getPetWindow();
    if (!petWin || petWin.isDestroyed()) return;
    const hasSession = !!payload.hasSession;
    const streaming = !!payload.streaming;
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];

    const template = [
      {
        label: "打开主窗口",
        accelerator: "CmdOrCtrl+1",
        click: () => {
          void openMainWindow();
        },
      },
      ...(sessions.length > 1
        ? [
            {
              label: "切换会话",
              submenu: sessions.map((s) => ({
                label: s.name || "(未命名)",
                type: "radio",
                checked: !!s.focused,
                click: () => {
                  const win = getPetWindow();
                  if (!win || win.isDestroyed()) return;
                  win.webContents.send("pet:switch-local-session", s.id);
                },
              })),
            },
          ]
        : []),
      {
        label: streaming ? "暂停当前任务" : "暂停当前任务（无运行中）",
        enabled: streaming,
        click: () => {
          const win = getPetWindow();
          if (!win || win.isDestroyed()) return;
          win.webContents.send("pet:request-abort");
        },
      },
      { type: "separator" },
      {
        label: "设置…",
        accelerator: process.platform === "darwin" ? "Cmd+," : "Ctrl+,",
        click: () => void openSettingsWindow(),
      },
      {
        label: "隐藏宠物",
        click: () => {
          const win = getPetWindow();
          if (win && !win.isDestroyed()) win.hide();
          updateTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "退出 Shaula Agent",
        accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
        click: () => app.quit(),
      },
    ];

    void hasSession;

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: petWin });
  });
}

module.exports = {
  registerPetIpc,
};
