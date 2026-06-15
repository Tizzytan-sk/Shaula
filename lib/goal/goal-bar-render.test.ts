import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalBar } from "@/app/components/GoalBar";
import type { RubricEvaluation } from "@/lib/evaluation/types";
import type { AgentGoal } from "@/lib/goal/types";

function evaluation(
  patch: Partial<RubricEvaluation> = {}
): RubricEvaluation {
  const createdAt = Date.now();
  return {
    id: "eval-1",
    rubricId: "goal-completion",
    evaluatorVersion: "test",
    subject: {},
    status: "failed",
    totalScore: 0.35,
    targetScore: 0.9,
    dimensionScores: [],
    criteria: [],
    hardFails: ["goal-evidence"],
    failedCriteria: ["goal-evidence"],
    triggeredPitfalls: [],
    missingEvidence: ["goal-evidence: requires diff"],
    minScoreFailures: ["evidence_traceability"],
    recommendation: "iterate",
    nextAction: "Collect and attach the missing evidence.",
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
        minDelta: 0.02,
        blockedRepeatLimit: 3,
      },
    },
    createdAt,
    ...patch,
  };
}

function goal(patch: Partial<AgentGoal> = {}): AgentGoal {
  const createdAt = Date.now();
  return {
    objective: "Ship the execution contract UI",
    status: "active",
    turns: 2,
    blockedStreak: 0,
    createdAt,
    updatedAt: createdAt,
    lastEvaluation: evaluation(),
    ...patch,
  };
}

describe("GoalBar evaluation badge", () => {
  it("surfaces the latest completion evaluation", () => {
    const html = renderToStaticMarkup(
      createElement(GoalBar, {
        goal: goal(),
        onPause: () => {},
        onResume: () => {},
        onClear: () => {},
      })
    );

    expect(html).toContain("eval failed 0.35/0.90");
    expect(html).toContain("Collect and attach the missing evidence.");
  });
});
