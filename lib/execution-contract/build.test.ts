import { describe, expect, it } from "vitest";
import { buildExecutionContract } from "./build";
import { toEvaluatorContractSource } from "./types";

describe("buildExecutionContract", () => {
  it("builds a bounded v0 contract from an objective", () => {
    const contract = buildExecutionContract({
      agentId: "agent-1",
      objective: "Fix the React layout and verify it in the browser",
      createdAt: 100,
    });

    expect(contract.id).toMatch(/^contract-100-/);
    expect(contract.rubricProfile).toBe("coding.frontend-ui");
    expect(contract.profileSelection).toMatchObject({
      source: "inferred",
      selectedProfile: "coding.frontend-ui",
      inferredProfile: "coding.frontend-ui",
    });
    expect(contract.requiredEvidence).toContain("browser_observation");
    expect(contract.acceptanceCriteria.map((item) => item.id)).toContain(
      "objective-met"
    );
    expect(contract.nonGoals.join(" ")).toMatch(/irreversible/);
  });

  it("can be summarized for the independent evaluator gate", () => {
    const contract = buildExecutionContract({
      agentId: "agent-1",
      objective: "Evaluate this skill",
      createdAt: 100,
    });

    expect(toEvaluatorContractSource(contract)).toMatchObject({
      objective: "Evaluate this skill",
      rubricProfile: "skill.eval",
    });
  });

  it("records explicit rubric profile overrides", () => {
    const contract = buildExecutionContract({
      agentId: "agent-1",
      objective: "Fix API tests without deleting files",
      rubricProfile: "workflow.default",
      createdAt: 100,
    });

    expect(contract.rubricProfile).toBe("workflow.default");
    expect(contract.profileSelection).toMatchObject({
      source: "override",
      selectedProfile: "workflow.default",
      inferredProfile: "coding.default",
      overrideProfile: "workflow.default",
    });
  });

  it("records explicit and inferred main artifacts", () => {
    const explicit = buildExecutionContract({
      agentId: "agent-1",
      objective: "Update the dashboard",
      mainArtifact: {
        kind: "url",
        label: "Local dashboard",
        href: "http://localhost:3000/dashboard",
        source: "explicit",
      },
      createdAt: 100,
    });
    expect(explicit.mainArtifact).toMatchObject({
      kind: "url",
      label: "Local dashboard",
      href: "http://localhost:3000/dashboard",
      source: "explicit",
    });

    const inferred = buildExecutionContract({
      agentId: "agent-1",
      objective: "Fix `app/components/GoalTimeline.tsx` rendering",
      createdAt: 101,
    });
    expect(inferred.mainArtifact).toMatchObject({
      kind: "file",
      label: "app/components/GoalTimeline.tsx",
      source: "objective",
    });
  });
});
