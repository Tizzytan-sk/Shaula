import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAllowedVerificationCommand, runVerificationCommand } from "./runner";

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
});
