import { describe, expect, it } from "vitest";
import { runLocalGoalDogfoodSet } from "./goal-run-set";

describe("local goal dogfood run set", () => {
  it("runs the five baseline goal dogfood cases", () => {
    const records = runLocalGoalDogfoodSet({
      agentId: "agent-1",
      createdAt: 100,
    });

    expect(records.map((item) => item.id)).toEqual([
      "code-change-success",
      "ui-check-success",
      "verifier-rejection",
      "failed-required-check",
      "needs-user-pause",
      "blocked-pause",
    ]);
    expect(records.map((item) => item.closureVerdict)).toEqual([
      "ready_to_finalize",
      "ready_to_finalize",
      "continue",
      "continue",
      "needs_user",
      "blocked",
    ]);
    expect(records.every((item) => item.closureVerdict === item.expectedVerdict)).toBe(
      true
    );
  });

  it("records evidence and intervention boundaries for each outcome class", () => {
    const byId = new Map(
      runLocalGoalDogfoodSet({ agentId: "agent-1", createdAt: 100 }).map((item) => [
        item.id,
        item,
      ])
    );

    expect(byId.get("code-change-success")).toMatchObject({
      verificationDecision: "accept",
      finalOutcome: "ready_to_finalize",
      autoContinueCount: 1,
      userIntervention: "none",
    });
    expect(byId.get("code-change-success")?.evidence.map((item) => item.kind)).toEqual([
      "diff",
      "test_result",
    ]);
    expect(byId.get("ui-check-success")?.evidence[0]).toMatchObject({
      kind: "screenshot",
      trustLevel: "host_observed",
    });
    expect(byId.get("verifier-rejection")).toMatchObject({
      verificationDecision: "reject",
      finalOutcome: "continued_after_rejection",
      autoContinueCount: 1,
      verifierRejections: 1,
      openActionCount: 1,
    });
    expect(byId.get("failed-required-check")).toMatchObject({
      verificationDecision: "reject",
      finalOutcome: "continued_after_rejection",
      autoContinueCount: 1,
      verifierRejections: 1,
      openActionCount: 1,
    });
    expect(byId.get("failed-required-check")?.evidence[0]).toMatchObject({
      kind: "test_result",
      outcome: "failed",
      metadata: {
        required: true,
        verificationCommandId: "npm-test",
        evidenceRequired: ["test_result"],
      },
    });
    expect(byId.get("needs-user-pause")).toMatchObject({
      finalOutcome: "paused_for_user",
      autoContinueCount: 0,
      userIntervention: "decision",
    });
    expect(byId.get("blocked-pause")).toMatchObject({
      finalOutcome: "paused_blocked",
      autoContinueCount: 0,
      userIntervention: "external_unblock",
    });
  });
});
