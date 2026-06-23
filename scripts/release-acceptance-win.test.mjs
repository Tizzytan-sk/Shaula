import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Windows release acceptance script", () => {
  it("renders a dry-run plan without creating state directories", async () => {
    const { stdout } = await execFileAsync("node", [
      "scripts/release-acceptance-win.mjs",
      "--dry-run",
    ]);
    const plan = JSON.parse(stdout);

    expect(plan).toMatchObject({
      install: false,
      installDir: null,
    });
    expect(plan.unpackedExe).toContain("dist");
    expect(plan.unpackedExe).toContain("Shaula Agent.exe");
    expect(plan.windowProbeFile).toBe(path.join(plan.stateDir, "window-probe.json"));
    expect(plan.settingsWindowProbeFile).toBe(
      path.join(plan.stateDir, "settings-window-probe.json")
    );
    expect(plan.teamWindowProbeFile).toBe(
      path.join(plan.stateDir, "team-window-probe.json")
    );
    expect(plan.serverProbeFile).toBe(path.join(plan.stateDir, "server-probe.json"));
    expect(existsSync(plan.stateDir)).toBe(false);
  });
});
