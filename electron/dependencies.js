const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function envValue(primaryName) {
  const primary = process.env[primaryName]?.trim();
  return primary || undefined;
}

function resolveExecutable(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveCloudflaredPath() {
  const configured = envValue("SHAULA_CLOUDFLARED_PATH");
  return resolveExecutable([
    configured,
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared",
  ]);
}

function resolveBrewPath() {
  return resolveExecutable([
    process.env.HOMEBREW_PREFIX
      ? path.join(process.env.HOMEBREW_PREFIX, "bin", "brew")
      : null,
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
  ]);
}

function runCommand(command, args, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
          process.env.PATH,
        ]
          .filter(Boolean)
          .join(":"),
      },
    });
    const append = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 20000) output = output.slice(-20000);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        output,
        error: "安装超时，请稍后重试或在终端运行：brew install cloudflared",
      });
    }, timeoutMs);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output, error: e.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        output,
        error: code === 0 ? null : `命令退出码 ${code ?? "unknown"}`,
      });
    });
  });
}

function getCloudflaredStatus() {
  const cloudflaredPath = resolveCloudflaredPath();
  const brewPath = resolveBrewPath();
  return {
    installed: Boolean(cloudflaredPath),
    path: cloudflaredPath,
    installable: Boolean(brewPath),
    installer: brewPath ? "homebrew" : null,
    installCommand: "brew install cloudflared",
    error: brewPath ? null : "未检测到 Homebrew，无法自动安装 cloudflared。",
  };
}

async function installCloudflared() {
  const existingPath = resolveCloudflaredPath();
  if (existingPath) {
    process.env.SHAULA_CLOUDFLARED_PATH = existingPath;
    return {
      ok: true,
      installed: true,
      path: existingPath,
      output: "cloudflared 已安装。",
    };
  }
  const brewPath = resolveBrewPath();
  if (!brewPath) {
    return {
      ok: false,
      installed: false,
      path: null,
      output: "",
      error:
        "未检测到 Homebrew，无法自动安装 cloudflared。请先安装 Homebrew，或手动安装 cloudflared。",
    };
  }
  const result = await runCommand(brewPath, ["install", "cloudflared"]);
  const nextPath = resolveCloudflaredPath();
  if (result.ok && nextPath) {
    process.env.SHAULA_CLOUDFLARED_PATH = nextPath;
  }
  return {
    ok: Boolean(result.ok && nextPath),
    installed: Boolean(nextPath),
    path: nextPath,
    output: result.output,
    error:
      result.ok && !nextPath
        ? "安装命令已完成，但仍未找到 cloudflared。"
        : result.error,
  };
}

module.exports = {
  getCloudflaredStatus,
  installCloudflared,
  resolveCloudflaredPath,
  resolveBrewPath,
  runCommand,
};
