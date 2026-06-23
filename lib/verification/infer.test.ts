import { describe, expect, it } from "vitest";
import { inferVerificationPlan } from "./infer";

describe("inferVerificationPlan", () => {
  it("infers required coding checks from contract evidence", () => {
    const plan = inferVerificationPlan({
      id: "plan-1",
      objective: "Ship UI change",
      profileId: "coding.frontend-ui",
      requiredEvidence: ["test_result", "browser_observation"],
      packageScripts: { test: "vitest run", build: "next build", lint: "eslint ." },
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.map((check) => check.id)).toEqual([
      "npm-test",
      "npm-build",
      "browser-observation",
    ]);
    expect(plan.checks.find((check) => check.id === "npm-test")).toMatchObject({
      type: "command",
      required: true,
      evidenceRequired: ["test_result"],
    });
    expect(
      plan.checks.find((check) => check.id === "browser-observation")
    ).toMatchObject({
      type: "browser_observation",
      required: true,
      evidenceRequired: ["browser_observation"],
    });
  });

  it("adds optional lint for source changes when lint is available", () => {
    const plan = inferVerificationPlan({
      objective: "Refactor helper",
      profileId: "coding.default",
      requiredEvidence: ["test_result"],
      changedFiles: ["lib/example.ts"],
      packageScripts: { test: "vitest run", lint: "eslint ." },
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.find((check) => check.id === "npm-lint")).toMatchObject({
      type: "command",
      required: false,
      evidenceRequired: ["lint_result"],
    });
  });

  it("falls back to npx tsc when typecheck is required but no script exists", () => {
    const plan = inferVerificationPlan({
      objective: "Fix TypeScript errors and provide typecheck evidence",
      profileId: "coding.default",
      requiredEvidence: ["typecheck"],
      packageScripts: { test: "vitest run" },
      hasTypeScriptConfig: true,
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.find((check) => check.id === "npx-tsc-no-emit")).toMatchObject({
      type: "command",
      command: "npx",
      args: ["tsc", "--noEmit", "--pretty", "false"],
      required: true,
      evidenceRequired: ["typecheck"],
    });
  });

  it("preserves type_check evidence tokens for coverage matching", () => {
    const plan = inferVerificationPlan({
      objective: "Provide type_check evidence",
      profileId: "coding.default",
      requiredEvidence: ["type_check"],
      packageScripts: { typecheck: "tsc --noEmit" },
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.find((check) => check.id === "npm-typecheck")).toMatchObject({
      evidenceRequired: ["type_check"],
    });
  });

  it("does not force npm test for browser-only frontend evidence", () => {
    const plan = inferVerificationPlan({
      objective: "Inspect local HTML and provide host browser observation.",
      profileId: "coding.frontend-ui",
      requiredEvidence: ["browser_observation"],
      packageScripts: { test: "node test.js" },
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.map((check) => check.id)).toEqual([
      "browser-observation",
    ]);
  });

  it("passes explicit browser targets into the browser observation check", () => {
    const plan = inferVerificationPlan({
      objective: "Verify the app in the browser",
      profileId: "coding.frontend-ui",
      requiredEvidence: ["browser_observation"],
      targetUrl: "http://127.0.0.1:3000/dashboard",
      targetSelector: "[data-testid='dashboard-ready']",
      targetText: "Dashboard",
      cwd: "C:/repo",
      createdAt: 1,
    });

    expect(plan.checks.find((check) => check.id === "browser-observation")).toMatchObject({
      type: "browser_observation",
      targetUrl: "http://127.0.0.1:3000/dashboard",
      selector: "[data-testid='dashboard-ready']",
      text: "Dashboard",
      timeoutMs: 30_000,
    });
  });
});
