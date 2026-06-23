import { describe, expect, it } from "vitest";
import {
  evidenceRefToEvaluationEvidence,
  requiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import {
  browserResultToEvidenceRef,
  blockingRequiredVerificationFailures,
  commandResultToEvidenceRef,
} from "./evidence";
import type {
  VerificationBrowserResult,
  VerificationCommandResult,
} from "./types";

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

function browserResult(
  patch: Partial<VerificationBrowserResult> = {}
): VerificationBrowserResult {
  return {
    planId: "plan-1",
    checkId: "browser-observation",
    kind: "browser_observation",
    label: "Browser observation",
    browserId: "agent:agent-1",
    targetUrl: "http://127.0.0.1:3000",
    required: true,
    evidenceRequired: ["browser_observation"],
    status: "passed",
    passed: true,
    url: "http://127.0.0.1:3000",
    title: "Ready",
    screenshotDataUrl: "data:image/png;base64,abc",
    durationMs: 50,
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

  it("converts passed browser checks into host-observed browser evidence", () => {
    const evidence = browserResultToEvidenceRef(browserResult(), {
      id: "browser-pass",
      agentId: "agent-1",
    });
    const evaluationEvidence = evidenceRefToEvaluationEvidence(evidence);

    expect(evidence).toMatchObject({
      id: "browser-pass",
      kind: "browser_snapshot",
      trustLevel: "host_observed",
      browserId: "agent:agent-1",
      source: { type: "browser", id: "agent:agent-1" },
    });
    expect(evaluationEvidence).toMatchObject({
      kind: "screenshot",
      trustLevel: "host_observed",
      outcome: "passed",
      verifiable: true,
    });
    expect(
      requiredEvidenceCoverage(["browser_observation"], [evaluationEvidence])
    ).toMatchObject({
      missing: [],
      matchedEvidenceIds: ["browser-pass"],
    });
  });

  it("blocks failed required browser checks until a newer pass exists", () => {
    const failed = evidenceRefToEvaluationEvidence(
      browserResultToEvidenceRef(
        browserResult({
          status: "failed",
          passed: false,
          error: "Text was not found",
          completedAt: 2,
        }),
        { id: "browser-failed" }
      )
    );
    const passed = evidenceRefToEvaluationEvidence(
      browserResultToEvidenceRef(
        browserResult({
          status: "passed",
          passed: true,
          completedAt: 4,
        }),
        { id: "browser-passed" }
      )
    );

    expect(requiredEvidenceCoverage(["browser_observation"], [failed])).toMatchObject({
      missing: ["browser_observation (requires host_observed)"],
    });
    expect(blockingRequiredVerificationFailures([failed])).toHaveLength(1);
    expect(blockingRequiredVerificationFailures([failed, passed])).toHaveLength(0);
  });
});
