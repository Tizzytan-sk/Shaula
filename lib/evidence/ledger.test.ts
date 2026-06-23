import { describe, expect, it } from "vitest";
import {
  evidenceRefToEvaluationEvidence,
  evidenceRefToGoalEvidence,
  requiredEvidenceCoverage,
} from "./ledger";
import type { EvidenceRef } from "./types";

function evidence(patch: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    id: "ev-1",
    kind: "progress_artifact",
    title: "reported test result",
    agentId: "agent-1",
    metadata: { kind: "test" },
    createdAt: 1,
    ...patch,
  };
}

describe("evidence ledger helpers", () => {
  it("keeps progress artifacts agent-reported even when their label says test", () => {
    const evaluationEvidence = evidenceRefToEvaluationEvidence(evidence());

    expect(evaluationEvidence).toMatchObject({
      kind: "test_result",
      trustLevel: "agent_reported",
      source: "progress:ev-1",
      verifiable: false,
    });
  });

  it("treats referenced progress artifacts as artifact references for analysis requirements", () => {
    const sourceNote = evidenceRefToEvaluationEvidence(
      evidence({
        id: "source-note",
        title: "source_note: package.json name field",
        metadata: {
          kind: "file",
          href: "C:/repo/package.json",
          cwd: "C:/repo",
        },
      })
    );
    const analysisArtifact = evidenceRefToEvaluationEvidence(
      evidence({
        id: "analysis-artifact",
        title: "analysis_artifact: package metadata summary",
        metadata: {
          kind: "other",
          href: "C:/repo/.scratch/analysis_artifact.md",
          cwd: "C:/repo",
        },
      })
    );

    expect(sourceNote).toMatchObject({
      href: "C:/repo/package.json",
      trustLevel: "artifact_reference",
      verifiable: true,
    });
    expect(analysisArtifact).toMatchObject({
      href: "C:/repo/.scratch/analysis_artifact.md",
      trustLevel: "artifact_reference",
      verifiable: true,
    });

    const coverage = requiredEvidenceCoverage(
      ["source_note", "analysis_artifact"],
      [sourceNote, analysisArtifact]
    );

    expect(coverage.missing).toEqual([]);
    expect(coverage.matchedEvidenceIds).toEqual([
      "source-note",
      "analysis-artifact",
    ]);
  });

  it("uses structured required-evidence tags before title heuristics", () => {
    const sourceNote = evidenceRefToEvaluationEvidence(
      evidence({
        id: "structured-source",
        title: "Package metadata",
        metadata: {
          kind: "file",
          href: "C:/repo/package.json",
          cwd: "C:/repo",
        },
        criteria: [{ requiredEvidence: "source_note" }],
      })
    );

    expect(sourceNote).toMatchObject({
      href: "C:/repo/package.json",
      trustLevel: "artifact_reference",
      metadata: expect.objectContaining({
        evidenceRequired: ["source_note"],
      }),
    });

    const coverage = requiredEvidenceCoverage(["source_note"], [sourceNote]);

    expect(coverage.missing).toEqual([]);
    expect(coverage.matchedEvidenceIds).toEqual(["structured-source"]);
  });

  it("does not let structured tags bypass deterministic trust requirements", () => {
    const reportedTest = evidenceRefToEvaluationEvidence(
      evidence({
        id: "reported-test",
        title: "Test result",
        metadata: { kind: "test" },
        criteria: [{ requiredEvidence: "test_result" }],
      })
    );

    const coverage = requiredEvidenceCoverage(["test_result"], [reportedTest]);

    expect(reportedTest).toMatchObject({
      kind: "test_result",
      trustLevel: "agent_reported",
    });
    expect(coverage.missing).toEqual([
      "test_result (requires deterministic_check)",
    ]);
  });

  it("keeps local progress references agent-reported without a workspace root", () => {
    const sourceNote = evidenceRefToEvaluationEvidence(
      evidence({
        id: "unscoped-source",
        title: "source_note: package.json",
        metadata: {
          kind: "file",
          href: "C:/repo/package.json",
        },
      })
    );

    const coverage = requiredEvidenceCoverage(["source_note"], [sourceNote]);

    expect(sourceNote).toMatchObject({
      trustLevel: "agent_reported",
      verifiable: false,
    });
    expect(coverage.missing).toEqual([
      "source_note (requires artifact_reference)",
    ]);
  });

  it("keeps local progress references agent-reported when outside the workspace", () => {
    const sourceNote = evidenceRefToEvaluationEvidence(
      evidence({
        id: "external-source",
        title: "source_note: package.json",
        metadata: {
          kind: "file",
          href: "C:/elsewhere/package.json",
          cwd: "C:/repo",
        },
      })
    );

    expect(sourceNote).toMatchObject({
      trustLevel: "agent_reported",
      verifiable: false,
    });
  });

  it("allows browser observations to satisfy browser requirements", () => {
    const browserEvidence = evidenceRefToEvaluationEvidence(
      evidence({
        id: "browser-1",
        kind: "browser_step",
        title: "Open local app",
        browserId: "agent:agent-1",
      })
    );

    const coverage = requiredEvidenceCoverage(
      ["browser_observation"],
      [browserEvidence]
    );

    expect(coverage.missing).toHaveLength(0);
    expect(coverage.matchedEvidenceIds).toEqual(["browser-1"]);
  });

  it("does not let failed browser observations satisfy browser requirements", () => {
    const failedBrowserEvidence = evidenceRefToEvaluationEvidence(
      evidence({
        id: "browser-failed",
        kind: "browser_step",
        title: "Verify local app",
        browserId: "agent:agent-1",
        metadata: {
          status: "done",
          passed: false,
        },
      })
    );

    const coverage = requiredEvidenceCoverage(
      ["browser_observation"],
      [failedBrowserEvidence]
    );

    expect(failedBrowserEvidence.outcome).toBe("failed");
    expect(coverage.missing).toEqual([
      "browser_observation (requires host_observed)",
    ]);
    expect(coverage.matchedEvidenceIds).toEqual([]);
  });

  it("rejects self-reported test evidence for deterministic requirements", () => {
    const reportedTest = evidenceRefToEvaluationEvidence(evidence());
    const coverage = requiredEvidenceCoverage(["test_result"], [reportedTest]);

    expect(coverage.missing).toEqual([
      "test_result (requires deterministic_check)",
    ]);
  });

  it("allows reported blocker logs to satisfy blocker evidence requirements", () => {
    const blockerLog = evidenceRefToEvaluationEvidence(
      evidence({
        id: "blocker-log",
        title: "Blocker: SHAULA_DOGFOOD_MISSING_TOKEN not available",
        metadata: { kind: "log" },
      })
    );

    const coverage = requiredEvidenceCoverage(["blocker_log"], [blockerLog]);

    expect(coverage.missing).toEqual([]);
    expect(coverage.matchedEvidenceIds).toEqual(["blocker-log"]);
  });

  it("allows structured blocked goal turns to satisfy blocked-state requirements", () => {
    const blockedTurn = evidenceRefToEvaluationEvidence({
      id: "blocked-turn",
      kind: "goal_turn",
      title: "Goal blocked: missing local credential",
      agentId: "agent-1",
      metadata: {
        status: "blocked",
        blockedState: {
          reason: "Missing local credential",
          category: "external_dependency",
        },
      },
      createdAt: 2,
    });

    const coverage = requiredEvidenceCoverage(["blocked_state"], [blockedTurn]);

    expect(coverage.missing).toEqual([]);
    expect(coverage.matchedEvidenceIds).toEqual(["blocked-turn"]);
  });

  it("rejects failed deterministic command evidence for coverage", () => {
    const failedTest = evidenceRefToEvaluationEvidence(
      evidence({
        id: "failed-test",
        kind: "verification_result",
        title: "Verification failed: npm test",
        trustLevel: "deterministic_check",
        metadata: {
          verificationKind: "test",
          evidenceRequired: ["test_result"],
          status: "failed",
          exitCode: 1,
        },
      })
    );

    const coverage = requiredEvidenceCoverage(["test_result"], [failedTest]);

    expect(coverage.missing).toEqual([
      "test_result (requires deterministic_check)",
    ]);
  });

  it("allows artifact diff plus passed deterministic test for coding requirements", () => {
    const diff = evidenceRefToEvaluationEvidence(
      evidence({
        id: "diff-file",
        title: "src/value.json diff",
        metadata: {
          kind: "diff",
          href: "src/value.json",
          cwd: "C:/repo",
        },
      })
    );
    const passedTest = evidenceRefToEvaluationEvidence(
      evidence({
        id: "passed-test",
        kind: "verification_result",
        title: "Verification passed: npm test",
        trustLevel: "deterministic_check",
        metadata: {
          verificationKind: "test",
          evidenceRequired: ["test_result"],
          status: "passed",
          exitCode: 0,
        },
      })
    );

    const coverage = requiredEvidenceCoverage(
      ["diff", "test_result"],
      [diff, passedTest]
    );

    expect(coverage.missing).toEqual([]);
    expect(coverage.matchedEvidenceIds).toEqual(["diff-file", "passed-test"]);
    expect(diff).toMatchObject({
      kind: "diff",
      trustLevel: "artifact_reference",
      href: "src/value.json",
    });
  });

  it("maps ledger evidence back into goal evidence shape", () => {
    expect(
      evidenceRefToGoalEvidence(
        evidence({ id: "diff-1", metadata: { kind: "diff" } })
      )
    ).toMatchObject({
      id: "diff-1",
      kind: "diff",
      title: "reported test result",
    });
  });
});
