import { describe, expect, it } from "vitest";
import {
  evidenceRefToEvaluationEvidence,
  requiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import {
  blockingRequiredVerificationFailures,
  commandResultToEvidenceRef,
} from "./evidence";
import type { VerificationCommandResult } from "./types";

function result(
  patch: Partial<VerificationCommandResult> = {}
): VerificationCommandResult {
  return {
    planId: "plan-1",
    commandId: "npm-test",
    kind: "test",
    label: "Run tests",
    command: "npm",
    args: ["test"],
    cwd: "C:/repo",
    required: true,
    evidenceRequired: ["test_result"],
    status: "passed",
    exitCode: 0,
    durationMs: 120,
    startedAt: 1,
    completedAt: 2,
    ...patch,
  };
}

describe("verification evidence", () => {
  it("converts passed command results into deterministic evidence", () => {
    const evidence = commandResultToEvidenceRef(result(), {
      id: "ev-1",
      agentId: "agent-1",
    });
    const evaluationEvidence = evidenceRefToEvaluationEvidence(evidence);

    expect(evidence).toMatchObject({
      id: "ev-1",
      kind: "verification_result",
      trustLevel: "deterministic_check",
      agentId: "agent-1",
    });
    expect(evaluationEvidence).toMatchObject({
      kind: "test_result",
      trustLevel: "deterministic_check",
      outcome: "passed",
      verifiable: true,
    });
  });

  it("does not let failed command evidence satisfy required coverage", () => {
    const failed = evidenceRefToEvaluationEvidence(
      commandResultToEvidenceRef(
        result({ status: "failed", exitCode: 1, completedAt: 3 }),
        { id: "failed-test" }
      )
    );

    const coverage = requiredEvidenceCoverage(["test_result"], [failed]);

    expect(coverage.missing).toEqual([
      "test_result (requires deterministic_check)",
    ]);
  });

  it("treats a later pass as superseding a failed required command", () => {
    const failed = evidenceRefToEvaluationEvidence(
      commandResultToEvidenceRef(
        result({ status: "failed", exitCode: 1, completedAt: 2 }),
        { id: "failed-test" }
      )
    );
    const passed = evidenceRefToEvaluationEvidence(
      commandResultToEvidenceRef(
        result({ status: "passed", exitCode: 0, completedAt: 4 }),
        { id: "passed-test" }
      )
    );

    expect(blockingRequiredVerificationFailures([failed, passed])).toHaveLength(0);
  });

  it("lets deterministic typecheck evidence satisfy typecheck requirements", () => {
    const typecheck = evidenceRefToEvaluationEvidence(
      commandResultToEvidenceRef(
        result({
          commandId: "npm-typecheck",
          kind: "typecheck",
          label: "Run typecheck",
          args: ["run", "typecheck"],
          evidenceRequired: ["type_check"],
        }),
        { id: "passed-typecheck" }
      )
    );

    expect(requiredEvidenceCoverage(["type_check"], [typecheck])).toMatchObject({
      missing: [],
      matchedEvidenceIds: ["passed-typecheck"],
    });
  });
});
