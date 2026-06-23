const { BrowserWindow, dialog, shell } = require("electron");
const os = require("node:os");
const dependenciesModule = require("./dependencies");

function registerCoreIpc({
  app,
  ipcMain,
  getApiBase,
  getLocalSecret,
  devUrl,
  isDev,
}) {
  ipcMain.handle("app:getInfo", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isElectron: true,
    isDev: Boolean(isDev),
  }));

  ipcMain.handle("app:getApiBase", () => getApiBase() || devUrl);
  ipcMain.handle("app:getLocalSecret", () => getLocalSecret());

  ipcMain.handle("deps:cloudflaredStatus", () =>
    dependenciesModule.getCloudflaredStatus()
  );

  ipcMain.handle("deps:installCloudflared", () =>
    dependenciesModule.installCloudflared()
  );

  ipcMain.handle("dialog:selectDirectory", async (event, opts) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: opts?.title ?? "选择目录",
      defaultPath: opts?.defaultPath ?? os.homedir(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("shell:revealInFinder", (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("shell:openExternal", async (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

module.exports = {
  registerCoreIpc,
};
