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
    expect(scripts["benchmark:shaula"]).toBe(
      "vitest run lib/skill-eval/runner.test.ts lib/dogfood/goal-run-set.test.ts lib/subagents/write-boundary.test.ts lib/workflows/script-runtime.test.ts lib/local-coding-assistant/adapter.test.ts scripts/provider-dogfood.test.mjs"
    );
    expect(scripts["workflow:sandbox:check"]).toBe(
      "node scripts/check-workflow-sandbox.mjs"
    );
    expect(scripts["dogfood:provider"]).toBe("node scripts/provider-dogfood.mjs");
  });

  it("keeps Windows installer packaging addressable", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["electron:build:win"]).toBe(
      "npm run clean && npm run build:electron && node scripts/build-electron.mjs --win nsis --x64"
    );
    expect(scripts["release:acceptance:win"]).toBe(
      "node scripts/release-acceptance-win.mjs"
    );
    expect(scripts["release:acceptance:win:unpacked"]).toBe(
      "node scripts/release-acceptance-win.mjs"
    );
    expect(scripts["release:acceptance:win:install"]).toBe(
      "node scripts/release-acceptance-win.mjs --install"
    );
  });

  it("keeps the PR CI gate aligned with the optimization backlog", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    for (const command of [
      "npm ci",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run benchmark:shaula",
      "npm run design-tokens:check",
      "npm run test:e2e",
    ]) {
      expect(workflow).toContain(command);
    }
  });
});
