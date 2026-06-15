import { describe, expect, it } from "vitest";
import type { EvaluationAction } from "@/lib/evaluation-actions/types";
import type { RubricEvaluation } from "@/lib/evaluation/types";
import type { AgentGoal } from "./types";
import type { GoalVerifyResult } from "./verifier";
import {
  buildGoalClosurePromptFragment,
  evaluateGoalRunClosure,
} from "./closure";

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    objective: "Ship closure",
    status: "active",
    turns: 1,
    blockedStreak: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<RubricEvaluation> = {}
): RubricEvaluation {
  return {
    id: "eval-1",
    rubricId: "goal-completion",
    evaluatorVersion: "test",
    subject: {},
    status: "passed",
    totalScore: 1,
    targetScore: 0.9,
    dimensionScores: [],
    criteria: [],
    hardFails: [],
    failedCriteria: [],
    triggeredPitfalls: [],
    missingEvidence: [],
    minScoreFailures: [],
    recommendation: "pass",
    nextAction: "Finalize.",
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
    ...overrides,
  };
}

function verification(
  overrides: Partial<GoalVerifyResult> = {}
): GoalVerifyResult {
  return {
    decision: "accept",
    reason: "Evidence is sufficient.",
    missingEvidence: [],
    evaluation: evaluation(),
    ...overrides,
  };
}

function action(
  overrides: Partial<EvaluationAction> = {}
): EvaluationAction {
  return {
    id: "action-1",
    agentId: "agent-1",
    key: "missing_evidence:test",
    kind: "missing_evidence",
    status: "open",
    title: "Collect evidence: test",
    detail: "test",
    target: "test",
    latestEvaluationId: "eval-1",
    recommendation: "iterate",
    nextAction: "Run the missing check.",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("goal run closure", () => {
  it("marks an accepted run as ready to finalize", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal(),
      verification: verification(),
      openActions: [],
      createdAt: 10,
    });

    expect(closure.verdict).toBe("ready_to_finalize");
    expect(closure.nextAction).toMatch(/goal_update/);
  });

  it("continues when verification is rejected", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal(),
      verification: verification({
        decision: "reject",
        reason: "Missing evidence.",
        missingEvidence: ["test_result"],
        evaluation: evaluation({
          status: "failed",
          totalScore: 0.2,
          recommendation: "iterate",
          nextAction: "Run tests.",
        }),
      }),
      openActions: [action()],
      createdAt: 10,
    });

    expect(closure.verdict).toBe("continue");
    expect(closure.missingEvidence).toEqual(["test_result"]);
    expect(closure.openActions[0]?.nextAction).toBe("Run the missing check.");
  });

  it("does not finalize when an accepted decision carries a failed evaluation", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal(),
      verification: verification({
        decision: "accept",
        reason: "Verifier accepted but rubric failed.",
        missingEvidence: [],
        evaluation: evaluation({
          status: "failed",
          totalScore: 0.4,
          recommendation: "iterate",
          nextAction: "Run required verification before finalizing.",
        }),
      }),
      openActions: [],
      createdAt: 10,
    });

    expect(closure.verdict).toBe("continue");
    expect(closure.nextAction).toBe("Run required verification before finalizing.");
  });

  it("requires the user when evaluator action asks for input", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal(),
      verification: verification({
        decision: "reject",
        evaluation: evaluation({
          status: "blocked",
          recommendation: "ask_user",
          nextAction: "Ask which path to take.",
        }),
      }),
      openActions: [
        action({
          kind: "ask_user",
          title: "Ask user for required input",
          nextAction: "Ask which path to take.",
        }),
      ],
      createdAt: 10,
    });

    expect(closure.verdict).toBe("needs_user");
    expect(closure.userQuestion).toBe("Ask user for required input");
  });

  it("surfaces blockers without auto-continuing", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal({
        status: "blocked",
        blockedReason: "Waiting for credentials.",
      }),
      verification: verification(),
      openActions: [],
      createdAt: 10,
    });

    expect(closure.verdict).toBe("blocked");
    expect(closure.reason).toBe("Waiting for credentials.");
  });

  it("preserves finalization prompt markers across ready closures", () => {
    const closure = evaluateGoalRunClosure({
      agentId: "agent-1",
      goal: goal(),
      verification: verification(),
      openActions: [],
      createdAt: 10,
    });

    closure.finalizationPromptedAt = 11;
    expect(closure.verdict).toBe("ready_to_finalize");
    expect(closure.finalizationPromptedAt).toBe(11);
  });

  it("injects closure details into continuation prompts", () => {
    const lines = buildGoalClosurePromptFragment({
      id: "closure-1",
      verdict: "continue",
      reason: "Missing evidence.",
      missingEvidence: ["test_result"],
      openActions: [
        {
          id: "action-1",
          kind: "missing_evidence",
          title: "Collect evidence",
          nextAction: "Run tests.",
        },
      ],
      nextAction: "Run tests.",
      createdAt: 10,
    });

    expect(lines.join("\n")).toContain("Missing evidence");
    expect(lines.join("\n")).toContain("Run tests");
  });
});
