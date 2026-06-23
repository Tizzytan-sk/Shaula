/**
 * [PoC] webview 容器方案验证：通过 webContents.debugger（CDP）控制 <webview>。
 *
 * 验证目标：Electron 主进程能否 attach 到 webview 的 webContents，执行 CDP 命令
 * （导航/截图/取 DOM），从而替代当前「Playwright 独立 Chromium + 截图流」方案，
 * 让画面原生渲染、所见即所控。
 *
 * 这是隔离的实验通道（webviewPoc:*），不触碰现有 /api/browser 与 screencast 路径。
 */
function registerWebviewPocIpc(ipcMain) {
  const { webContents } = require("electron");

  /** 拿到 webview 的 webContents（前端传 getWebContentsId() 的返回值） */
  function getWebviewContents(webContentsId) {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`webview webContents not found: ${webContentsId}`);
    }
    return wc;
  }

  /** 确保 debugger 已 attach（幂等） */
  function ensureDebuggerAttached(wc) {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }
  }

  // attach debugger 到指定 webview，验证 CDP 通道可用
  ipcMain.handle("webviewPoc:attach", async (_e, webContentsId) => {
    const wc = getWebviewContents(webContentsId);
    ensureDebuggerAttached(wc);
    // 启用核心 CDP domain，验证命令可下发
    await wc.debugger.sendCommand("Page.enable");
    await wc.debugger.sendCommand("DOM.enable");
    await wc.debugger.sendCommand("Runtime.enable");
    return { ok: true, attached: wc.debugger.isAttached() };
  });

  // 通过 CDP 导航（区别于 webview.src，验证 agent 可主动驱动导航）
  ipcMain.handle("webviewPoc:navigate", async (_e, webContentsId, url) => {
    const wc = getWebviewContents(webContentsId);
    ensureDebuggerAttached(wc);
    try {
      await wc.debugger.sendCommand("Page.navigate", { url });
      return { ok: true, url };
    } catch (e) {
      // Chromium may abort an in-flight same-target navigation when the webview
      // receives a newer load request. Treat that as non-fatal for the PoC IPC.
      if (e && (e.code === "ERR_ABORTED" || e.errno === -3)) {
        return { ok: true, url, aborted: true };
      }
      throw e;
    }
  });

  // 取页面标题/URL（验证 DOM/Runtime 读取链路）
  ipcMain.handle("webviewPoc:inspect", async (_e, webContentsId) => {
    const wc = getWebviewContents(webContentsId);
    ensureDebuggerAttached(wc);
    const titleEval = await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const urlEval = await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return {
      ok: true,
      title: titleEval?.result?.value ?? null,
      url: urlEval?.result?.value ?? null,
    };
  });

  // CDP 截图（验证画面采集；对比 screencast，这里是按需单帧）
  ipcMain.handle("webviewPoc:screenshot", async (_e, webContentsId) => {
    const wc = getWebviewContents(webContentsId);
    const image = await Promise.race([
      wc.capturePage(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("webview screenshot timed out")), 8000)
      ),
    ]);
    return {
      ok: true,
      dataUrl: image && typeof image.toDataURL === "function" ? image.toDataURL() : null,
    };
  });

  // CDP 坐标点击（验证 agent 操控链路：Input.dispatchMouseEvent）
  ipcMain.handle("webviewPoc:click", async (_e, webContentsId, x, y) => {
    const wc = getWebviewContents(webContentsId);
    ensureDebuggerAttached(wc);
    const base = { x, y, button: "left", clickCount: 1 };
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...base,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...base,
    });
    return { ok: true, x, y };
  });

  // detach（清理）
  ipcMain.handle("webviewPoc:detach", async (_e, webContentsId) => {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
      wc.debugger.detach();
    }
    return { ok: true };
  });
}

module.exports = {
  registerWebviewPocIpc,
};
