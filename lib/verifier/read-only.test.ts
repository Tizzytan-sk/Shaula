import { describe, expect, it } from "vitest";
import {
  buildReadOnlyVerifierPrompt,
  buildReadOnlyVerifierRequest,
  buildReadOnlyVerifierSubagentTask,
  isReadOnlyVerifierToolAllowed,
  parseReadOnlyVerifierResult,
  sanitizeReadOnlyVerifierTools,
} from "./read-only";

describe("read-only verifier path", () => {
  it("sanitizes verifier input and strips unsafe tools", () => {
    const request = buildReadOnlyVerifierRequest({
      id: "verify-1",
      objective: "Ship feature",
      contract: {
        objective: "Ship feature",
        requiredEvidence: ["test_result"],
      },
      evidence: [
        {
          id: "ev-1",
          kind: "test_result",
          title: "Tests passed",
          trustLevel: "deterministic_check",
          metadata: { secret: "must not be copied" },
        },
      ],
      allowedTools: ["read_files", "apply_patch", "shell", "browser_snapshot"],
      createdAt: 1,
    });

    expect(request.allowedTools).toEqual(["read_files", "browser_snapshot"]);
    expect(request.evidence[0].metadata).toBeUndefined();
    expect(request.evidence[0]).toMatchObject({
      id: "ev-1",
      kind: "test_result",
      trustLevel: "deterministic_check",
    });
  });

  it("rejects write-capable and external-action tools", () => {
    expect(isReadOnlyVerifierToolAllowed("read_files")).toBe(true);
    expect(isReadOnlyVerifierToolAllowed("file_write")).toBe(false);
    expect(isReadOnlyVerifierToolAllowed("shell")).toBe(false);
    expect(isReadOnlyVerifierToolAllowed("deploy_preview")).toBe(false);
    expect(isReadOnlyVerifierToolAllowed("browser_click")).toBe(false);
    expect(sanitizeReadOnlyVerifierTools(["read_files", "delete_file"])).toEqual([
      "read_files",
    ]);
  });

  it("builds a read-only subagent task with structured-output prompt", () => {
    const request = buildReadOnlyVerifierRequest({
      id: "verify-1",
      objective: "Ship feature",
      allowedTools: ["read_files", "edit_file"],
      createdAt: 1,
    });
    const prompt = buildReadOnlyVerifierPrompt(request);
    const task = buildReadOnlyVerifierSubagentTask(request);

    expect(prompt).toContain("Return only JSON");
    expect(prompt).toContain("Do not modify files");
    expect(task.allowedTools).toEqual(["read_files"]);
    expect(task.writePaths).toBeUndefined();
    expect(task.maxTurns).toBe(2);
  });

  it("parses verifier result defensively", () => {
    expect(
      parseReadOnlyVerifierResult(
        JSON.stringify({
          decision: "reject",
          reason: "Missing tests",
          missingEvidence: ["test_result"],
          failedCriteria: ["goal-evidence"],
          confidence: 1.5,
        })
      )
    ).toEqual({
      decision: "reject",
      reason: "Missing tests",
      missingEvidence: ["test_result"],
      failedCriteria: ["goal-evidence"],
      confidence: 1,
    });
  });

  it("parses fenced and singly wrapped verifier JSON", () => {
    expect(
      parseReadOnlyVerifierResult(
        'Verifier says:\n```json\n{"decision":"accept","reason":"Looks good","missingEvidence":[],"failedCriteria":[],"confidence":0.8}\n```'
      )
    ).toMatchObject({
      decision: "accept",
      reason: "Looks good",
      confidence: 0.8,
    });

    expect(
      parseReadOnlyVerifierResult(
        'Result: {"decision":"reject","reason":"No evidence","missingEvidence":["test_result"],"failedCriteria":[],"confidence":0.4}'
      )
    ).toMatchObject({
      decision: "reject",
      missingEvidence: ["test_result"],
    });
  });

  it("downgrades wrapped accept output to needs_review", () => {
    expect(
      parseReadOnlyVerifierResult(
        'Looks good: {"decision":"accept","reason":"Enough evidence","missingEvidence":[],"failedCriteria":[],"confidence":0.9}'
      )
    ).toMatchObject({
      decision: "needs_review",
      confidence: 0.9,
    });
  });

  it("does not accept invalid or multi-object verifier output", () => {
    expect(
      parseReadOnlyVerifierResult(
        '{"decision":"accept","reason":"one","confidence":1} {"decision":"accept","reason":"two","confidence":1}'
      )
    ).toMatchObject({
      decision: "needs_review",
      confidence: 0,
    });

    expect(parseReadOnlyVerifierResult("not json")).toMatchObject({
      decision: "needs_review",
      confidence: 0,
    });
  });
});
