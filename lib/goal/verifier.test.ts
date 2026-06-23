import { describe, expect, it } from "vitest";
import type { GoalEvidence } from "./types";
import {
  buildVerifierRejectionNote,
  verifyGoalCompletion,
  type GoalVerifyInput,
} from "./verifier";

function evidence(id: string): GoalEvidence {
  return { id, kind: "file", title: id, createdAt: Date.now() };
}

function input(over: Partial<GoalVerifyInput> = {}): GoalVerifyInput {
  return {
    goal: { objective: "Ship feature" },
    evidence: [evidence("e1")],
    turns: [],
    ...over,
  };
}

describe("goal verifier v1", () => {
  it("accepts completion when evidence exists and nothing failed", () => {
    const result = verifyGoalCompletion(input());
    expect(result.decision).toBe("accept");
    expect(result.missingEvidence).toHaveLength(0);
  });

  it("rejects completion with no evidence", () => {
    const result = verifyGoalCompletion(input({ evidence: [] }));
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toMatch(/evidence/i);
  });

  it("rejects self-reported evidence when the contract requires deterministic checks", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "reported-test",
            kind: "test",
            title: "tests pass",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "reported-test",
            kind: "test_result",
            title: "tests pass",
            trustLevel: "agent_reported",
            source: "progress",
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["test_result"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "test_result (requires deterministic_check)"
    );
    expect(result.evaluation.status).toBe("failed");
  });

  it("accepts trusted evidence that covers the contract requirement", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Check local UI" },
        evidence: [
          {
            id: "browser-proof",
            kind: "browser",
            title: "Browser observed UI",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "browser-proof",
            kind: "screenshot",
            title: "Browser observed UI",
            trustLevel: "host_observed",
            source: "browser:agent:agent-1",
          },
        ],
        contract: {
          objective: "Check local UI",
          requiredEvidence: ["browser_observation"],
        },
        completionClaim: {
          finalSummary: "Browser observation confirms the local UI.",
          evidenceIds: ["browser-proof"],
        },
        requireCompletionClaim: true,
      })
    );

    expect(result.decision).toBe("accept");
    expect(result.evaluation.status).toBe("passed");
  });

  it("rejects contracted completion without a structured final summary", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Check local UI" },
        evidence: [
          {
            id: "browser-proof",
            kind: "browser",
            title: "Browser observed UI",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "browser-proof",
            kind: "screenshot",
            title: "Browser observed UI",
            trustLevel: "host_observed",
            source: "browser:agent:agent-1",
          },
        ],
        contract: {
          objective: "Check local UI",
          requiredEvidence: ["browser_observation"],
        },
        requireCompletionClaim: true,
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "Structured final summary is required"
    );
    expect(result.evaluation.hardFails).toContain("final-summary-evidence");
  });

  it("accepts a structured final summary that cites covering evidence", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "test-proof",
            kind: "test",
            title: "Verification passed: npm test",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "test-proof",
            kind: "test_result",
            title: "Verification passed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "passed",
            metadata: { evidenceRequired: ["test_result"] },
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["test_result"],
        },
        completionClaim: {
          finalSummary: "Implemented the feature and npm test passed.",
          evidenceIds: ["test-proof"],
        },
        requireCompletionClaim: true,
      })
    );

    expect(result.decision).toBe("accept");
    expect(result.evaluation.criteria).toContainEqual(
      expect.objectContaining({
        criterionId: "final-summary-evidence",
        status: "pass",
        evidenceIds: ["test-proof"],
      })
    );
  });

  it("rejects a structured final summary without evidence citations", () => {
    const result = verifyGoalCompletion(
      input({
        completionClaim: {
          finalSummary: "The goal is complete.",
          evidenceIds: [],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "must cite at least one recorded evidence id"
    );
    expect(result.evaluation.hardFails).toContain("final-summary-evidence");
  });

  it("rejects a structured final summary that cites unknown evidence", () => {
    const result = verifyGoalCompletion(
      input({
        completionClaim: {
          finalSummary: "The goal is complete.",
          evidenceIds: ["missing-proof"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "unknown evidence id: missing-proof"
    );
  });

  it("rejects a structured final summary that cites evidence not covering the contract", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "browser-proof",
            kind: "browser",
            title: "Browser observed UI",
            createdAt: Date.now(),
          },
          {
            id: "test-proof",
            kind: "test",
            title: "Verification passed: npm test",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "browser-proof",
            kind: "screenshot",
            title: "Browser observed UI",
            trustLevel: "host_observed",
            source: "browser:agent:agent-1",
          },
          {
            id: "test-proof",
            kind: "test_result",
            title: "Verification passed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "passed",
            metadata: { evidenceRequired: ["test_result"] },
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["test_result"],
        },
        completionClaim: {
          finalSummary: "The feature is done.",
          evidenceIds: ["browser-proof"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "does not cite evidence covering required evidence"
    );
  });

  it("rejects failed required verification evidence", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "failed-test",
            kind: "test",
            title: "Verification failed: npm test",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "failed-test",
            kind: "test_result",
            title: "Verification failed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "failed",
            metadata: {
              required: true,
              verificationCommandId: "npm-test",
              evidenceRequired: ["test_result"],
            },
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["test_result"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "Required verification failed"
    );
  });

  it("rejects failed required browser verification evidence", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Verify UI" },
        evidence: [
          {
            id: "failed-browser",
            kind: "browser",
            title: "Browser verification failed: Browser observation",
            createdAt: Date.now(),
          },
        ],
        evaluationEvidence: [
          {
            id: "failed-browser",
            kind: "screenshot",
            title: "Browser verification failed: Browser observation",
            trustLevel: "host_observed",
            source: "browser:agent:agent-1",
            outcome: "failed",
            metadata: {
              required: true,
              verificationCheckId: "browser-observation",
              verificationKind: "browser_observation",
              evidenceRequired: ["browser_observation"],
            },
          },
        ],
        contract: {
          objective: "Verify UI",
          requiredEvidence: ["browser_observation"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "Required verification failed"
    );
  });

  it("rejects a newer failed required check even when older evidence passed", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "passed-test",
            kind: "test",
            title: "Verification passed: npm test",
            createdAt: 1,
          },
          {
            id: "failed-test",
            kind: "test",
            title: "Verification failed: npm test",
            createdAt: 2,
          },
        ],
        evaluationEvidence: [
          {
            id: "passed-test",
            kind: "test_result",
            title: "Verification passed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "passed",
            metadata: {
              required: true,
              verificationCommandId: "npm-test",
              evidenceRequired: ["test_result"],
            },
            createdAt: 1,
          },
          {
            id: "failed-test",
            kind: "test_result",
            title: "Verification failed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "failed",
            metadata: {
              required: true,
              verificationCommandId: "npm-test",
              evidenceRequired: ["test_result"],
            },
            createdAt: 2,
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["test_result"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "Required verification failed"
    );
  });

  it("rejects deterministic checks that ran before the latest diff", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship feature" },
        evidence: [
          {
            id: "passed-test",
            kind: "test",
            title: "Verification passed: npm test",
            createdAt: 1,
          },
          {
            id: "latest-diff",
            kind: "diff",
            title: "src/feature.ts diff",
            href: "C:/repo/src/feature.ts",
            createdAt: 2,
          },
        ],
        evaluationEvidence: [
          {
            id: "passed-test",
            kind: "test_result",
            title: "Verification passed: npm test",
            trustLevel: "deterministic_check",
            source: "system:verification-plan",
            outcome: "passed",
            metadata: {
              required: true,
              verificationCommandId: "npm-test",
              evidenceRequired: ["test_result"],
            },
            createdAt: 1,
          },
          {
            id: "latest-diff",
            kind: "diff",
            title: "src/feature.ts diff",
            href: "C:/repo/src/feature.ts",
            trustLevel: "artifact_reference",
            source: "progress",
            createdAt: 2,
          },
        ],
        contract: {
          objective: "Ship feature",
          requiredEvidence: ["diff", "test_result"],
        },
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain("Stale verification");
  });

  it("flags out-of-scope diff evidence for review without blocking completion", () => {
    const result = verifyGoalCompletion(
      input({
        goal: { objective: "Ship scoped feature" },
        evidence: [
          {
            id: "outside-diff",
            kind: "diff",
            title: "scripts/tool.ts diff",
            href: "C:/repo/scripts/tool.ts",
            createdAt: 2,
          },
        ],
        evaluationEvidence: [
          {
            id: "outside-diff",
            kind: "diff",
            title: "scripts/tool.ts diff",
            href: "C:/repo/scripts/tool.ts",
            trustLevel: "artifact_reference",
            source: "progress",
            createdAt: 2,
          },
        ],
        contract: {
          objective: "Ship scoped feature",
          scope: ["Only edit `C:/repo/src`."],
          requiredEvidence: ["diff"],
        },
        completionClaim: {
          finalSummary: "Implemented the scoped feature diff.",
          evidenceIds: ["outside-diff"],
        },
        requireCompletionClaim: true,
      })
    );

    expect(result.decision).toBe("accept");
    expect(result.evaluation.status).toBe("warning");
    expect(result.evaluation.triggeredPitfalls.join(" ")).toContain(
      "out-of-scope diff"
    );
  });

  it("rejects completion when a workflow failed", () => {
    const result = verifyGoalCompletion(
      input({ workflowStatuses: ["completed", "failed"] })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toMatch(/failed\/aborted/);
  });

  it("rejects completion when a workflow aborted", () => {
    const result = verifyGoalCompletion(
      input({ workflowStatuses: ["aborted"] })
    );
    expect(result.decision).toBe("reject");
  });

  it("accepts when all workflows completed", () => {
    const result = verifyGoalCompletion(
      input({ workflowStatuses: ["completed", "completed"] })
    );
    expect(result.decision).toBe("accept");
  });

  it("accepts when a failed workflow is superseded by a later completed run", () => {
    const result = verifyGoalCompletion(
      input({
        workflowRuns: [
          { status: "failed", createdAt: 1, id: "failed-old" },
          { status: "completed", createdAt: 2, id: "completed-new" },
        ],
      })
    );
    expect(result.decision).toBe("accept");
  });

  it("rejects when a failed workflow is newer than the latest completed run", () => {
    const result = verifyGoalCompletion(
      input({
        workflowRuns: [
          { status: "completed", createdAt: 1, id: "completed-old" },
          { status: "failed", createdAt: 2, id: "failed-new" },
        ],
      })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toMatch(/failed\/aborted/);
  });

  it("rejects when a related workflow is still running", () => {
    const result = verifyGoalCompletion(
      input({ workflowRuns: [{ status: "running", createdAt: 1 }] })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toMatch(/pending\/running/);
  });

  it("rejects when a required acceptance criterion is unmet", () => {
    const result = verifyGoalCompletion(
      input({
        goal: {
          objective: "Ship feature",
          acceptanceCriteria: [
            {
              id: "c1",
              criterion: "All tests pass",
              status: "pending",
            },
          ],
        },
      })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toMatch(/All tests pass/);
  });

  it("accepts when all acceptance criteria are met", () => {
    const result = verifyGoalCompletion(
      input({
        goal: {
          objective: "Ship feature",
          acceptanceCriteria: [
            { id: "c1", criterion: "All tests pass", status: "met" },
          ],
        },
        completionClaim: {
          finalSummary: "All acceptance criteria are met.",
          evidenceIds: ["e1"],
        },
        requireCompletionClaim: true,
      })
    );
    expect(result.decision).toBe("accept");
  });

  it("rejects acceptance-gated completion without a structured final summary", () => {
    const result = verifyGoalCompletion(
      input({
        goal: {
          objective: "Ship feature",
          acceptanceCriteria: [
            { id: "c1", criterion: "All tests pass", status: "met" },
          ],
        },
        requireCompletionClaim: true,
      })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.join(" ")).toContain(
      "Structured final summary is required"
    );
  });

  it("aggregates multiple missing reasons", () => {
    const result = verifyGoalCompletion(
      input({
        evidence: [],
        workflowStatuses: ["failed"],
        goal: {
          objective: "x",
          acceptanceCriteria: [
            { id: "c1", criterion: "build green", status: "failed" },
          ],
        },
      })
    );
    expect(result.decision).toBe("reject");
    expect(result.missingEvidence.length).toBeGreaterThanOrEqual(3);
  });

  it("builds a readable rejection note", () => {
    const result = verifyGoalCompletion(input({ evidence: [] }));
    const note = buildVerifierRejectionNote(result);
    expect(note).toContain("NOT accepted");
    expect(note).toContain("Still missing:");
  });

  it("returns empty note for an accepted result", () => {
    const result = verifyGoalCompletion(input());
    expect(buildVerifierRejectionNote(result)).toBe("");
  });
});
