import { describe, expect, it } from "vitest";
import type { ExecutionContract } from "@/lib/execution-contract/types";
import {
  buildGoalStartPrompt,
  buildPromptRunProtocol,
  initialPromptProgress,
  isGoalPostAction,
} from "./goal-actions";

function contract(overrides: Partial<ExecutionContract> = {}): ExecutionContract {
  const now = 1_700_000_000_000;
  return {
    id: "contract-1",
    version: 1,
    agentId: "agent-1",
    objective: "Ship the goal action split",
    scope: ["app/api/agent/[id]/route.ts", "lib/agent-actions"],
    nonGoals: ["Do not rewrite runtime"],
    acceptanceCriteria: [
      {
        id: "objective-met",
        description: "The route delegates goal actions.",
        required: true,
        evidenceRequired: ["test_result"],
      },
    ],
    requiredEvidence: ["diff", "test_result"],
    rubricProfile: "coding.default",
    allowedCapabilities: ["read_workspace", "edit_workspace"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("goal action helpers", () => {
  it("classifies only goal POST actions", () => {
    expect(isGoalPostAction("goal_set")).toBe(true);
    expect(isGoalPostAction("goal_update")).toBe(true);
    expect(isGoalPostAction("progress_update")).toBe(false);
    expect(isGoalPostAction("prompt")).toBe(false);
  });

  it("builds compact initial progress for long objectives", () => {
    const longTail = "tail-marker";
    const progress = initialPromptProgress(
      contract({
        objective: `任务说明 ${"很长的目标内容".repeat(80)} ${longTail}`,
      })
    );

    expect(progress.replaceSteps).toBe(true);
    expect(progress.steps?.[0]?.title).toContain("确认任务契约");
    expect(progress.steps?.[0]?.title).not.toContain(longTail);
    expect(progress.artifacts?.[0]?.summary).not.toContain(longTail);
  });

  it("keeps protocol and goal start prompt evidence-oriented", () => {
    const c = contract();

    expect(buildPromptRunProtocol(c)).toContain("required evidence: diff, test_result");
    expect(buildPromptRunProtocol(c)).toContain("Keep update_progress current");
    expect(buildPromptRunProtocol(c)).toContain("finalSummary and evidenceIds");

    const prompt = buildGoalStartPrompt(c.objective, c);
    expect(prompt).toContain("goal_update with status=complete");
    expect(prompt).toContain("finalSummary plus evidenceIds");
    expect(prompt).toContain("required evidence: diff, test_result");
  });
});
