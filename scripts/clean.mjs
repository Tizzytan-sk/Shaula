import { rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLEAN_TARGET_NAMES = ["dist", ".next"];

export function assertShaulaPackage(pkg, root) {
  if (!pkg || pkg.name !== "shaula-agent") {
    throw new Error(`Refusing to clean unexpected project root: ${root}`);
  }
}

export function assertInsideRoot(root, target) {
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to clean outside workspace: ${target}`);
  }
}

export function resolveCleanTargets(root, targetNames = CLEAN_TARGET_NAMES) {
  return targetNames.map((targetName) => {
    const target = resolve(root, targetName);
    assertInsideRoot(root, target);
    return target;
  });
}

export async function cleanProject(
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  io = { readFile, rm }
) {
  const pkg = JSON.parse(await io.readFile(join(root, "package.json"), "utf8"));
  assertShaulaPackage(pkg, root);
  for (const target of resolveCleanTargets(root)) {
    await io.rm(target, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await cleanProject();
}
