const settingsModule = require("./settings");

function registerSettingsIpc({ app, ipcMain, openSettingsWindow, reloadServer }) {
  ipcMain.handle("settings:open", async () => {
    await openSettingsWindow();
    return true;
  });

  ipcMain.handle("settings:listProviders", () =>
    settingsModule.listStoredProviders()
  );
  ipcMain.handle("settings:getKey", (_event, provider) =>
    settingsModule.getKey(provider)
  );
  ipcMain.handle("settings:setKey", (_event, provider, value) =>
    settingsModule.setKey(provider, value)
  );
  ipcMain.handle("settings:deleteKey", (_event, provider) =>
    settingsModule.deleteKey(provider)
  );
  ipcMain.handle("settings:load", () => settingsModule.loadSettings(app));
  ipcMain.handle("settings:save", (_event, partial) =>
    settingsModule.saveSettings(app, partial)
  );
  ipcMain.handle("settings:getProviderEnvMap", () =>
    settingsModule.PROVIDER_ENV_MAP
  );
  ipcMain.handle("settings:reloadServer", reloadServer);
}

module.exports = {
  registerSettingsIpc,
};
