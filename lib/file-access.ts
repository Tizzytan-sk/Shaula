import path from "node:path";
import { getShaulaFileAccessRoot } from "./shaula-paths";

export function normalizeRequestedFsPath(
  value: string,
  platform: NodeJS.Platform = process.platform
): string {
  const trimmed = value.trim();
  if (platform === "win32" && /^[a-zA-Z]:$/.test(trimmed)) {
    return `${trimmed}\\`;
  }
  return trimmed;
}

export function assertFileAccessAllowed(value: string): string {
  const abs = path.resolve(normalizeRequestedFsPath(value));
  const root = getShaulaFileAccessRoot();
  if (!root) return abs;

  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path outside SHAULA_WEB_ROOT (${root}): ${abs}. Clear SHAULA_WEB_ROOT or set it to this drive to browse other locations.`
    );
  }
  return abs;
}
