import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readPackageScripts() {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  return pkg.scripts;
}

describe("package script guardrails", () => {
  it("runs the Next patch before production build", async () => {
    const scripts = await readPackageScripts();

    expect(scripts.build).toBe(
      "node scripts/patch-next.mjs && node scripts/build-next.mjs --no-standalone"
    );
  });

  it("generates Next route types before TypeScript checking", async () => {
    const scripts = await readPackageScripts();

    expect(scripts.typecheck).toBe("next typegen && tsc --noEmit --pretty false");
  });

  it("keeps e2e and workflow sandbox checks addressable by verification plans", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["test:e2e"]).toBe("playwright test");
    expect(scripts["workflow:sandbox:check"]).toBe(
      "node scripts/check-workflow-sandbox.mjs"
    );
  });

  it("keeps Windows installer packaging addressable", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["electron:build:win"]).toBe(
      "npm run clean && npm run build:electron && node scripts/build-electron.mjs --win nsis --x64"
    );
  });
});
