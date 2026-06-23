import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  isAllowedVerificationCommand,
  runVerificationBrowserCheck,
  runVerificationCommand,
  runVerificationPlan,
} from "./runner";

describe("verification runner command policy", () => {
  it("allows known local verification commands", () => {
    expect(isAllowedVerificationCommand({ command: "npm", args: ["test"] })).toBe(true);
    expect(
      isAllowedVerificationCommand({ command: "npm", args: ["run", "lint"] })
    ).toBe(true);
    expect(
      isAllowedVerificationCommand({
        command: "npx",
        args: ["tsc", "--noEmit", "--pretty", "false"],
      })
    ).toBe(true);
  });

  it("rejects arbitrary commands", () => {
    expect(
      isAllowedVerificationCommand({ command: "powershell", args: ["Remove-Item"] })
    ).toBe(false);
    expect(isAllowedVerificationCommand({ command: "npm", args: ["install"] })).toBe(false);
  });

  it("rejects argument expansion on allowed verification commands", () => {
    expect(
      isAllowedVerificationCommand({
        command: "npm",
        args: ["run", "lint", "--", "--fix"],
      })
    ).toBe(false);
    expect(
      isAllowedVerificationCommand({
        command: "npx",
        args: ["tsc", "--noEmit", "--generateTrace", "trace"],
      })
    ).toBe(false);
  });

  it("records spawn failures as failed verification results", async () => {
    const result = await runVerificationCommand({
      id: "missing-cwd-typecheck",
      type: "command",
      kind: "typecheck",
      label: "Run TypeScript typecheck",
      command: "npx",
      args: ["tsc", "--noEmit", "--pretty", "false"],
      cwd: join(tmpdir(), `shaula-missing-cwd-${Date.now()}`),
      required: true,
      evidenceRequired: ["typecheck"],
      rationale: "Regression test for spawn failure evidence.",
      timeoutMs: 1_000,
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.stderrPreview).toMatch(/ENOENT|EINVAL|no such|invalid/i);
  });

  it("runs npm test in a fixture workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "shaula-verification-runner-"));
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          private: true,
          scripts: { test: "node test.js" },
        }),
        "utf8"
      );
      writeFileSync(join(root, "test.js"), "console.log('ok')\n", "utf8");

      const result = await runVerificationCommand({
        id: "npm-test-fixture",
        type: "command",
        kind: "test",
        label: "Run tests",
        command: "npm",
        args: ["test"],
        cwd: root,
        required: true,
        evidenceRequired: ["test_result"],
        rationale: "Regression test for npm command execution.",
        timeoutMs: 30_000,
      });

      expect(result.status).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.stdoutPreview).toContain("ok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails browser checks when no browser observer is available", async () => {
    const result = await runVerificationBrowserCheck({
      id: "browser-observation",
      type: "browser_observation",
      kind: "browser_observation",
      label: "Browser observation",
      targetUrl: "http://127.0.0.1:3000",
      required: true,
      evidenceRequired: ["browser_observation"],
      rationale: "Frontend work needs host browser evidence.",
    });

    expect(result).toMatchObject({
      checkId: "browser-observation",
      kind: "browser_observation",
      status: "failed",
      passed: false,
      required: true,
    });
    expect(result.error).toMatch(/browser observer unavailable/i);
  });

  it("runs browser checks through the injected observer", async () => {
    const plan = {
      id: "plan-browser",
      objective: "Verify UI",
      createdAt: 1,
      checks: [
        {
          id: "browser-observation",
          type: "browser_observation" as const,
          kind: "browser_observation" as const,
          label: "Browser observation",
          targetUrl: "http://127.0.0.1:3000",
          selector: "[data-testid='ready']",
          required: true,
          evidenceRequired: ["browser_observation"],
          rationale: "Frontend work needs host browser evidence.",
        },
      ],
    };

    const results = await runVerificationPlan(plan, {
      browserObserver: async (check) => ({
        browserId: "agent:agent-1",
        passed: check.selector === "[data-testid='ready']",
        url: check.targetUrl,
        title: "Ready",
        screenshotDataUrl: "data:image/png;base64,abc",
        textPreview: "Selector is visible.",
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "browser_observation",
      status: "passed",
      passed: true,
      browserId: "agent:agent-1",
      screenshotDataUrl: "data:image/png;base64,abc",
    });
  });

  it("times out slow browser observers", async () => {
    const result = await runVerificationBrowserCheck(
      {
        id: "browser-observation",
        type: "browser_observation",
        kind: "browser_observation",
        label: "Browser observation",
        required: true,
        evidenceRequired: ["browser_observation"],
        rationale: "Frontend work needs host browser evidence.",
        timeoutMs: 5,
      },
      {
        browserObserver: async () => new Promise<never>(() => {}),
      }
    );

    expect(result).toMatchObject({
      status: "timed_out",
      passed: false,
      timedOut: true,
    });
    expect(result.error).toContain("timed out");
  });
});
