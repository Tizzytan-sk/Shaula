const { Menu, Tray, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function createTrayIcon(dev) {
  const iconPath = dev
    ? path.resolve(__dirname, "..", "build", "trayTemplate.png")
    : path.join(process.resourcesPath, "trayTemplate.png");
  const retinaIconPath = dev
    ? path.resolve(__dirname, "..", "build", "trayTemplate@2x.png")
    : path.join(process.resourcesPath, "trayTemplate@2x.png");
  const image = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
  if (fs.existsSync(retinaIconPath)) {
    image.addRepresentation({
      scaleFactor: 2,
      buffer: fs.readFileSync(retinaIconPath),
    });
  }
  if (image.isEmpty()) {
    console.warn(`[electron] tray icon is empty: ${iconPath}`);
  }
  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }
  return image;
}

function createTrayController({
  app,
  dev,
  devUrl,
  disablePetWindow,
  getApiBase,
  getPetWindow,
  createPetWindow,
  openMainWindow,
  openSettingsWindow,
  checkForUpdates,
}) {
  let tray = null;

  function updateTrayMenu() {
    if (!tray) return;
    const petWin = getPetWindow();
    const petVisible = !!(
      petWin &&
      !petWin.isDestroyed() &&
      petWin.isVisible()
    );
    const template = [
      {
        label: "打开 Shaula Agent",
        click: () => void openMainWindow(),
      },
      {
        label: "设置…",
        accelerator: process.platform === "darwin" ? "Cmd+," : "Ctrl+,",
        click: () => void openSettingsWindow(),
      },
      {
        label: petVisible ? "隐藏宠物" : "显示宠物",
        click: async () => {
          if (disablePetWindow) return;
          const base = getApiBase() || devUrl;
          let win = getPetWindow();
          if (!win || win.isDestroyed()) {
            win = await createPetWindow(base);
          }
          if (!win || win.isDestroyed()) return;
          if (win.isVisible()) win.hide();
          else win.show();
          updateTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "检查更新",
        enabled: !dev,
        click: () => {
          void checkForUpdates({ manual: true });
        },
      },
      { type: "separator" },
      {
        label: "退出 Shaula Agent",
        accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
        click: () => app.quit(),
      },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  function createTray() {
    if (tray) return tray;
    const icon = createTrayIcon(dev);
    tray = new Tray(icon);
    tray.setImage(icon);
    tray.setToolTip("Shaula Agent");
    tray.on("click", () => void openMainWindow());
    tray.on("right-click", () => {
      updateTrayMenu();
      tray.popUpContextMenu();
    });
    updateTrayMenu();
    console.log("[electron] tray created");
    if (dev) {
      setTimeout(() => {
        if (!tray) return;
        console.log("[electron] tray bounds", tray.getBounds());
      }, 1000).unref();
    }
    return tray;
  }

  return {
    createTray,
    updateTrayMenu,
  };
}

module.exports = {
  createTrayController,
};
