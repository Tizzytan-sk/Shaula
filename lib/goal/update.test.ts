import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExecutionContract } from "../execution-contract/build";
import {
  __setExecutionContractStoreRootForTest,
  putExecutionContract,
} from "../execution-contract/store";
import {
  __resetEvidenceStoreForTest,
  appendEvidence,
} from "../evidence/server-store";
import {
  __resetEvaluationActionsForTest,
  listEvaluationActions,
} from "../evaluation-actions/store";
import {
  __setWorkflowStoreRootForTest,
  putWorkflowRun,
} from "../workflows/server-store";
import type { WorkflowRun } from "../workflows/types";
import {
  __setGoalStoreRootForTest,
  addGoalEvidence,
  getGoal,
  setGoal,
} from "./file-store";
import { applyGoalUpdate } from "./update";

describe("applyGoalUpdate (verifier integration)", () => {
  let root: string;
  let workflowRoot: string;
  let contractRoot: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "shaula-agent-goals-"));
    workflowRoot = mkdtempSync(path.join(os.tmpdir(), "shaula-agent-workflows-"));
    contractRoot = mkdtempSync(path.join(os.tmpdir(), "shaula-contracts-"));
    __setGoalStoreRootForTest(root);
    __setWorkflowStoreRootForTest(workflowRoot);
    __setExecutionContractStoreRootForTest(contractRoot);
    __resetEvidenceStoreForTest();
    __resetEvaluationActionsForTest();
  });

  afterEach(() => {
    __setGoalStoreRootForTest(null);
    __setWorkflowStoreRootForTest(null);
    __setExecutionContractStoreRootForTest(null);
    __resetEvidenceStoreForTest();
    __resetEvaluationActionsForTest();
    rmSync(root, { recursive: true, force: true });
    rmSync(workflowRoot, { recursive: true, force: true });
    rmSync(contractRoot, { recursive: true, force: true });
  });

  function workflow(
    id: string,
    patch: Partial<WorkflowRun> & Pick<WorkflowRun, "parentAgentId" | "status" | "createdAt">
  ): WorkflowRun {
    return {
      id,
      objective: id,
      rationale: "test workflow",
      script: "return true;",
      manifest: {
        capabilities: ["spawn_agent", "read_files"],
        maxAgents: 8,
        maxConcurrency: 4,
        timeoutMs: 600000,
        runtime: "process",
      },
      artifacts: [],
      checkpoints: [],
      logs: [],
      ...patch,
    };
  }

  it("returns not-accepted when no goal exists", () => {
    const result = applyGoalUpdate("missing", { status: "complete" });
    expect(result.accepted).toBe(false);
    expect(result.goal).toBeNull();
  });

  it("rejects a premature complete with no evidence and keeps the goal active", () => {
    setGoal("agent-1", "Do the thing");

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(false);
    expect(result.rejectionNote).toBeTruthy();
    expect(result.rejectionNote).toContain("NOT accepted");
    expect(result.evaluation?.status).toBe("failed");
    // Goal must remain active.
    const stored = getGoal("agent-1");
    expect(stored?.status).toBe("active");
    expect(stored?.lastEvaluation?.status).toBe("failed");
    expect(stored?.lastEvaluation?.missingEvidence.length).toBeGreaterThan(0);
    expect(listEvaluationActions({ agentId: "agent-1", status: "open" }).length)
      .toBeGreaterThan(0);
  });

  it("resolves evaluation actions after a later accepted complete", () => {
    setGoal("agent-1", "Do the thing");
    applyGoalUpdate("agent-1", { status: "complete" });
    expect(listEvaluationActions({ agentId: "agent-1", status: "open" }).length)
      .toBeGreaterThan(0);

    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });
    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(true);
    expect(listEvaluationActions({ agentId: "agent-1", status: "open" })).toHaveLength(0);
    expect(listEvaluationActions({ agentId: "agent-1", status: "resolved" }).length)
      .toBeGreaterThan(0);
  });

  it("accepts complete once evidence exists", () => {
    setGoal("agent-1", "Do the thing");
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });

    const result = applyGoalUpdate("agent-1", {
      status: "complete",
      finalSummary: "The work is complete and tests pass.",
      evidenceIds: ["ev-1"],
    });

    expect(result.accepted).toBe(true);
    expect(result.rejectionNote).toBeUndefined();
    expect(result.evaluation?.status).toBe("passed");
    const stored = getGoal("agent-1");
    expect(stored?.status).toBe("complete");
    expect(stored?.completedAt).toBeTypeOf("number");
    expect(stored?.lastEvaluation?.status).toBe("passed");
    expect(stored?.lastCompletionClaim).toEqual({
      finalSummary: "The work is complete and tests pass.",
      evidenceIds: ["ev-1"],
    });
    expect(stored?.lastFinalMessageAudit).toBeUndefined();
    expect(stored?.lastEvaluation?.totalScore).toBeGreaterThanOrEqual(
      stored?.lastEvaluation?.targetScore ?? 1
    );
  });

  it("rejects complete when the structured final summary cites missing evidence", () => {
    setGoal("agent-1", "Do the thing");
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });

    const result = applyGoalUpdate("agent-1", {
      status: "complete",
      finalSummary: "The work is complete.",
      evidenceIds: ["missing-proof"],
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectionNote).toContain("unknown evidence id");
    expect(result.evaluation?.hardFails).toContain("final-summary-evidence");
    expect(getGoal("agent-1")?.status).toBe("active");
  });

  it("rejects contracted complete without a structured final summary", () => {
    const contract = putExecutionContract({
      ...buildExecutionContract({
        agentId: "agent-1",
        objective: "Check the local UI",
        createdAt: 1,
      }),
      requiredEvidence: ["browser_observation"],
    });
    const goal = setGoal("agent-1", "Check the local UI", undefined, {
      contractId: contract.id,
    });
    appendEvidence({
      id: "browser-proof",
      kind: "browser_step",
      title: "Browser observed local UI",
      agentId: "agent-1",
      browserId: "agent:agent-1",
      createdAt: goal.createdAt + 1,
    });

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(false);
    expect(result.rejectionNote).toContain("Structured final summary is required");
    expect(result.evaluation?.hardFails).toContain("final-summary-evidence");
    expect(getGoal("agent-1")?.status).toBe("active");
  });

  it("accepts trusted ledger evidence for a contract requirement", () => {
    const contract = putExecutionContract({
      ...buildExecutionContract({
        agentId: "agent-1",
        objective: "Check the local UI",
        createdAt: 1,
      }),
      requiredEvidence: ["browser_observation"],
    });
    const goal = setGoal("agent-1", "Check the local UI", undefined, {
      contractId: contract.id,
    });
    appendEvidence({
      id: "browser-proof",
      kind: "browser_step",
      title: "Browser observed local UI",
      agentId: "agent-1",
      browserId: "agent:agent-1",
      createdAt: goal.createdAt + 1,
    });

    const result = applyGoalUpdate("agent-1", {
      status: "complete",
      finalSummary: "Browser verification observed the local UI.",
      evidenceIds: ["browser-proof"],
    });

    expect(result.accepted).toBe(true);
    expect(result.evaluation?.status).toBe("passed");
    expect(getGoal("agent-1")?.status).toBe("complete");
  });

  it("rejects failed browser ledger evidence for a browser contract requirement", () => {
    const contract = putExecutionContract({
      ...buildExecutionContract({
        agentId: "agent-1",
        objective: "Check the local UI",
        createdAt: 1,
      }),
      requiredEvidence: ["browser_observation"],
    });
    const goal = setGoal("agent-1", "Check the local UI", undefined, {
      contractId: contract.id,
    });
    appendEvidence({
      id: "browser-failed",
      kind: "browser_step",
      title: "Browser verification failed",
      agentId: "agent-1",
      browserId: "agent:agent-1",
      metadata: {
        status: "done",
        passed: false,
      },
      createdAt: goal.createdAt + 1,
    });

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(false);
    expect(result.rejectionNote).toContain("NOT accepted");
    expect(result.evaluation?.status).toBe("failed");
    expect(getGoal("agent-1")?.status).toBe("active");
  });

  it("opens a review action for out-of-scope diff evidence without blocking completion", () => {
    const contract = putExecutionContract({
      ...buildExecutionContract({
        agentId: "agent-1",
        objective: "Ship scoped change",
        createdAt: 1,
      }),
      scope: ["Only edit `C:/repo/src`."],
      requiredEvidence: ["diff"],
    });
    const goal = setGoal("agent-1", "Ship scoped change", undefined, {
      contractId: contract.id,
    });
    appendEvidence({
      id: "outside-diff",
      kind: "progress_artifact",
      title: "scripts/tool.ts diff",
      agentId: "agent-1",
      metadata: {
        kind: "diff",
        href: "C:/repo/scripts/tool.ts",
        cwd: "C:/repo",
      },
      createdAt: goal.createdAt + 1,
    });

    const result = applyGoalUpdate("agent-1", {
      status: "complete",
      finalSummary: "Scoped diff is complete; review outside-scope finding.",
      evidenceIds: ["outside-diff"],
    });

    expect(result.accepted).toBe(true);
    expect(result.evaluation?.status).toBe("warning");
    expect(getGoal("agent-1")?.status).toBe("complete");
    expect(listEvaluationActions({ agentId: "agent-1", kind: "triggered_pitfall" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "open",
          target: expect.stringContaining("out-of-scope diff"),
        }),
      ])
    );
  });

  it("ignores failed workflows created before the active goal", () => {
    putWorkflowRun(
      workflow("old-failed", {
        parentAgentId: "agent-1",
        status: "failed",
        createdAt: Date.now() - 10000,
        endedAt: Date.now() - 9000,
      })
    );
    setGoal("agent-1", "Do the thing");
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(true);
    expect(getGoal("agent-1")?.status).toBe("complete");
  });

  it("accepts when a later successful workflow supersedes an earlier goal-era failure", () => {
    const goal = setGoal("agent-1", "Do the thing");
    putWorkflowRun(
      workflow("failed-during-goal", {
        parentAgentId: "agent-1",
        status: "failed",
        createdAt: goal.createdAt + 1,
        endedAt: goal.createdAt + 2,
      })
    );
    putWorkflowRun(
      workflow("success-after-failure", {
        parentAgentId: "agent-1",
        status: "completed",
        createdAt: goal.createdAt + 3,
        endedAt: goal.createdAt + 4,
      })
    );
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(true);
    expect(getGoal("agent-1")?.status).toBe("complete");
  });

  it("rejects when the newest goal-era workflow failure is unresolved", () => {
    const goal = setGoal("agent-1", "Do the thing");
    putWorkflowRun(
      workflow("success-before-failure", {
        parentAgentId: "agent-1",
        status: "completed",
        createdAt: goal.createdAt + 1,
        endedAt: goal.createdAt + 2,
      })
    );
    putWorkflowRun(
      workflow("failed-after-success", {
        parentAgentId: "agent-1",
        status: "failed",
        createdAt: goal.createdAt + 3,
        endedAt: goal.createdAt + 4,
      })
    );
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });

    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(false);
    expect(result.rejectionNote).toContain("failed/aborted");
    expect(getGoal("agent-1")?.status).toBe("active");
  });

  it("applies blocked directly without verification", () => {
    setGoal("agent-1", "Do the thing");

    const result = applyGoalUpdate("agent-1", {
      status: "blocked",
      blockedReason: "Missing API key",
    });

    expect(result.accepted).toBe(true);
    expect(getGoal("agent-1")?.status).toBe("blocked");
    expect(getGoal("agent-1")?.blockedReason).toBe("Missing API key");
  });

  it("clears stale completion evaluation and closure when the goal becomes blocked", () => {
    setGoal("agent-1", "Do the thing");
    applyGoalUpdate("agent-1", { status: "complete" });
    expect(getGoal("agent-1")?.lastEvaluation?.status).toBe("failed");

    applyGoalUpdate("agent-1", {
      status: "blocked",
      blockedReason: "Need user decision",
    });

    expect(getGoal("agent-1")?.status).toBe("blocked");
    expect(getGoal("agent-1")?.lastEvaluation).toBeUndefined();
    expect(getGoal("agent-1")?.lastClosure).toBeUndefined();
  });

  it("writes a structured blocked state with inferred category", () => {
    setGoal("agent-1", "Do the thing");
    applyGoalUpdate("agent-1", {
      status: "blocked",
      blockedReason: "Waiting for approval",
    });

    const state = getGoal("agent-1")?.blockedState;
    expect(state?.category).toBe("needs_approval");
    expect(state?.repeatedCount).toBe(1);
    expect(state?.unblockAction).toBeTruthy();
    expect(getGoal("agent-1")?.blockedStreak).toBe(1);
  });

  it("increments repeatedCount when the same blocker recurs", () => {
    setGoal("agent-1", "Do the thing");
    applyGoalUpdate("agent-1", { status: "blocked", blockedReason: "stuck" });
    applyGoalUpdate("agent-1", { status: "blocked", blockedReason: "stuck" });

    expect(getGoal("agent-1")?.blockedState?.repeatedCount).toBe(2);
    expect(getGoal("agent-1")?.blockedStreak).toBe(2);
  });

  it("resets blocked streak and resolves state on accepted complete", () => {
    setGoal("agent-1", "Do the thing");
    applyGoalUpdate("agent-1", { status: "blocked", blockedReason: "stuck" });
    addGoalEvidence("agent-1", {
      id: "ev-1",
      kind: "test",
      title: "tests pass",
      createdAt: Date.now(),
    });
    // Goal is blocked; move back to a verifiable complete path. The verifier
    // reads status-independent inputs, so completing works once evidence exists.
    const result = applyGoalUpdate("agent-1", { status: "complete" });

    expect(result.accepted).toBe(true);
    expect(getGoal("agent-1")?.status).toBe("complete");
    expect(getGoal("agent-1")?.blockedStreak).toBe(0);
    expect(getGoal("agent-1")?.blockedState?.resolvedAt).toBeTypeOf("number");
  });
});
