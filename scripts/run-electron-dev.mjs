import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn(electronBinary, ["electron/main.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_DEV: "1",
  },
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
