import { beforeEach, describe, expect, it } from "vitest";
import type { RubricEvaluation } from "@/lib/evaluation/types";
import {
  __resetEvaluationActionsForTest,
  listEvaluationActions,
  reconcileEvaluationActions,
} from "./store";

function evaluation(patch: Partial<RubricEvaluation> = {}): RubricEvaluation {
  return {
    id: "eval-1",
    rubricId: "goal-completion",
    evaluatorVersion: "test",
    subject: {},
    status: "failed",
    totalScore: 0.4,
    targetScore: 0.9,
    dimensionScores: [],
    criteria: [],
    hardFails: ["goal-evidence"],
    failedCriteria: ["goal-evidence"],
    triggeredPitfalls: [],
    missingEvidence: ["goal-evidence: requires test_result"],
    minScoreFailures: ["verification_evidence"],
    recommendation: "iterate",
    nextAction: "Collect missing evidence.",
    weightSnapshot: {
      profileId: "goal.completion",
      targetScore: 0.9,
      dimensions: [],
      importanceWeights: {
        essential: 1,
        important: 0.7,
        optional: 0.3,
        pitfall: 0.9,
      },
      exitPolicy: {
        maxIterations: 4,
        blockedRepeatLimit: 3,
      },
    },
    createdAt: 1,
    ...patch,
  };
}

describe("evaluation action store", () => {
  beforeEach(() => {
    __resetEvaluationActionsForTest();
  });

  it("opens actions from failed evaluation gaps", () => {
    const actions = reconcileEvaluationActions({
      agentId: "agent-1",
      evaluation: evaluation(),
      createdAt: 10,
    });

    expect(actions.map((item) => item.kind).sort()).toEqual([
      "failed_criterion",
      "hard_fail",
      "min_score_failure",
      "missing_evidence",
    ].sort());
    expect(listEvaluationActions({ agentId: "agent-1", status: "open" })).toHaveLength(4);
  });

  it("resolves open actions when latest evaluation passes", () => {
    reconcileEvaluationActions({
      agentId: "agent-1",
      evaluation: evaluation(),
      createdAt: 10,
    });

    reconcileEvaluationActions({
      agentId: "agent-1",
      evaluation: evaluation({
        id: "eval-2",
        status: "passed",
        totalScore: 1,
        hardFails: [],
        failedCriteria: [],
        missingEvidence: [],
        minScoreFailures: [],
        recommendation: "pass",
        nextAction: "Accepted.",
      }),
      createdAt: 20,
    });

    expect(listEvaluationActions({ agentId: "agent-1", status: "open" })).toHaveLength(0);
    expect(listEvaluationActions({ agentId: "agent-1", status: "resolved" })).toHaveLength(4);
  });
});
