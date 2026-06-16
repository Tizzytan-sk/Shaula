import os from "node:os";
import path from "node:path";

const PRIMARY_STATE_DIR = ".shaula";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalizeConfiguredPath(value: string): string {
  if (process.platform === "win32" && /^[a-zA-Z]:$/.test(value)) {
    return `${value}\\`;
  }
  return value;
}

export function getShaulaStateRoot(): string {
  const explicit = cleanEnv(process.env.SHAULA_HOME);
  if (explicit) return path.resolve(normalizeConfiguredPath(expandHome(explicit)));

  return path.join(os.homedir(), PRIMARY_STATE_DIR);
}

export function getShaulaWebRoot(): string {
  const configured = process.env.SHAULA_WEB_ROOT;
  if (configured === undefined) return os.homedir();
  if (configured === "" || configured === "/") return "/";
  return path.resolve(normalizeConfiguredPath(expandHome(configured)));
}

export function getShaulaFileAccessRoot(): string | undefined {
  const configured = process.env.SHAULA_WEB_ROOT;
  if (configured === undefined || configured === "" || configured === "/") {
    return undefined;
  }
  return path.resolve(normalizeConfiguredPath(expandHome(configured)));
}

export function getShaulaEnv(primaryName: string): string | undefined {
  return cleanEnv(process.env[primaryName]);
}
