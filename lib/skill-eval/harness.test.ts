import { beforeEach, describe, expect, it } from "vitest";
import {
  evidenceRefToEvaluationEvidence,
  requiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import {
  __resetEvidenceStoreForTest,
  listEvidence,
} from "@/lib/evidence/server-store";
import { buildSkillEvalContract, evaluateSkillEvalRun } from "./harness";
import { recordSkillEvalRunEvidence } from "./store";
import { SHAULA_SKILL_EVAL_SUITE_V1 } from "./suite";

function baseRunInput() {
  return {
    id: "run-1",
    agentId: "agent-1",
    skillName: "sample-skill",
    skillPath: "C:/skills/sample-skill/SKILL.md",
    baselineVersion: "v1",
    candidateVersion: "v2",
    versionDiff: { summary: "Tightened trigger boundaries." },
    cases: [
      {
        id: "positive-basic",
        title: "Positive trigger",
        prompt: "Use sample-skill for a matching task",
        expectedBehavior: "Skill should trigger and complete the task.",
        kind: "positive" as const,
      },
      {
        id: "negative-boundary",
        title: "Negative boundary",
        prompt: "Use sample-skill for an unrelated task",
        expectedBehavior: "Skill should not trigger.",
        kind: "negative" as const,
      },
    ],
    results: [
      {
        caseId: "positive-basic",
        status: "pass" as const,
        reason: "Triggered correctly.",
      },
      {
        caseId: "negative-boundary",
        status: "pass" as const,
        reason: "Stayed out of scope.",
      },
    ],
    createdAt: 100,
  };
}

describe("skill eval harness", () => {
  beforeEach(() => {
    __resetEvidenceStoreForTest();
  });

  it("builds a skill.eval execution contract", () => {
    const contract = buildSkillEvalContract({
      agentId: "agent-1",
      skillName: "sample-skill",
      createdAt: 100,
    });

    expect(contract.rubricProfile).toBe("skill.eval");
    expect(contract.requiredEvidence).toEqual([
      "eval_run",
      "rubric_score",
      "version_diff",
    ]);
  });

  it("evaluates a passing skill run and emits reusable evidence", () => {
    const run = evaluateSkillEvalRun(baseRunInput());
    const evaluationEvidence = run.evidence.map(evidenceRefToEvaluationEvidence);
    const coverage = requiredEvidenceCoverage(
      ["eval_run", "rubric_score", "version_diff"],
      evaluationEvidence
    );

    expect(run.evaluation.status).toBe("passed");
    expect(run.weightedScore).toBe(1);
    expect(run.evidence.map((item) => item.criteria?.[0]?.requiredEvidence)).toEqual([
      "eval_run",
      "rubric_score",
      "version_diff",
    ]);
    expect(coverage.missing).toEqual([]);
  });

  it("fails when version diff is missing", () => {
    const input = baseRunInput();
    const run = evaluateSkillEvalRun({
      ...input,
      baselineVersion: undefined,
      candidateVersion: undefined,
      versionDiff: undefined,
    });

    expect(run.evaluation.status).toBe("failed");
    expect(run.evidence.map((item) => item.criteria?.[0]?.requiredEvidence)).toEqual([
      "eval_run",
      "rubric_score",
    ]);
    expect(run.evaluation.failedCriteria).toContain("skill-version-diff");
  });

  it("records skill eval evidence in the shared ledger", () => {
    const run = evaluateSkillEvalRun(baseRunInput());
    recordSkillEvalRunEvidence(run);

    const evidence = listEvidence({ agentId: "agent-1" });

    expect(evidence).toHaveLength(3);
    expect(evidence.map((item) => item.source?.id)).toEqual([
      "skill-eval",
      "skill-eval",
      "skill-eval",
    ]);
  });

  it("carries benchmark metadata into run evidence", () => {
    const run = evaluateSkillEvalRun({
      ...baseRunInput(),
      metrics: {
        modelTier: "weak_pressure",
        turnCount: 3,
        verifierRejectionCount: 1,
        openActionCount: 2,
        changedFiles: ["lib/example.ts"],
        testsRun: ["npm test"],
        browserEvidence: ["screenshot:goal"],
        manualIntervention: false,
      },
    });

    expect(run.metrics).toMatchObject({
      modelTier: "weak_pressure",
      verifierRejectionCount: 1,
      openActionCount: 2,
    });
    expect(run.evidence[0].metadata?.metrics).toMatchObject({
      changedFiles: ["lib/example.ts"],
      testsRun: ["npm test"],
    });
  });

  it("defines the benchmark-derived Shaula suite v1", () => {
    expect(SHAULA_SKILL_EVAL_SUITE_V1.cases.map((item) => item.id)).toEqual([
      "preflight-evidence-ledger",
      "task-a-typecheck-fallback",
      "task-b-readonly-verifier-dirty-json",
      "task-c-route-decision-visibility",
    ]);
  });
});
