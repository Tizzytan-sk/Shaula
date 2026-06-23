import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExecutionContract } from "@/lib/execution-contract/build";
import {
  __setExecutionContractStoreRootForTest,
  putExecutionContract,
} from "@/lib/execution-contract/store";
import {
  __resetEvidenceStoreForTest,
  listEvidence,
} from "@/lib/evidence/server-store";
import { __resetEvaluationActionsForTest } from "@/lib/evaluation-actions/store";
import {
  __setGoalStoreRootForTest,
  getGoal,
  setGoal,
} from "@/lib/goal/file-store";
import { applyGoalUpdate } from "@/lib/goal/update";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import { __setWorkflowStoreRootForTest } from "@/lib/workflows/server-store";
import { ensureBrowserVerificationForGoal } from "./goal-runner";

const browserMocks = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  browserScreenshot: vi.fn(),
  browserVerify: vi.fn(),
}));

vi.mock("@/lib/browser/runtime", () => browserMocks);

const BROWSER_SNAPSHOT = {
  status: "ready",
  url: "http://127.0.0.1:3000/",
  title: "Local app",
  screenshotDataUrl: "data:image/png;base64,abc",
  updatedAt: 2,
  error: null,
  pointer: null,
  task: null,
  logs: [],
  steps: [],
  annotations: [],
};

describe("goal verification runner", () => {
  let root: string;
  let workflowRoot: string;
  let contractRoot: string;
  let runtimeRoot: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "shaula-goal-runner-"));
    workflowRoot = mkdtempSync(path.join(os.tmpdir(), "shaula-goal-runner-workflows-"));
    contractRoot = mkdtempSync(path.join(os.tmpdir(), "shaula-goal-runner-contracts-"));
    runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "shaula-goal-runner-runtime-"));
    __setGoalStoreRootForTest(root);
    __setWorkflowStoreRootForTest(workflowRoot);
    __setExecutionContractStoreRootForTest(contractRoot);
    __setRuntimeLedgerRootForTest(runtimeRoot);
    __resetEvidenceStoreForTest();
    __resetEvaluationActionsForTest();
    browserMocks.browserOpen.mockReset();
    browserMocks.browserScreenshot.mockReset();
    browserMocks.browserVerify.mockReset();
  });

  afterEach(() => {
    __setGoalStoreRootForTest(null);
    __setWorkflowStoreRootForTest(null);
    __setExecutionContractStoreRootForTest(null);
    __setRuntimeLedgerRootForTest(null);
    __resetEvidenceStoreForTest();
    __resetEvaluationActionsForTest();
    rmSync(root, { recursive: true, force: true });
    rmSync(workflowRoot, { recursive: true, force: true });
    rmSync(contractRoot, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  });

  it("runs browser-only preflight when browser evidence is missing", async () => {
    const contract = putExecutionContract({
      ...buildExecutionContract({
        agentId: "agent-1",
        objective: "Verify the local UI",
        createdAt: 1,
      }),
      requiredEvidence: ["browser_observation"],
    });
    setGoal("agent-1", "Verify the local UI", undefined, {
      contractId: contract.id,
    });
    browserMocks.browserScreenshot.mockResolvedValue({
      result: { url: BROWSER_SNAPSHOT.url },
      snapshot: BROWSER_SNAPSHOT,
    });

    const preflight = await ensureBrowserVerificationForGoal({
      agentId: "agent-1",
      cwd: root,
      sessionId: "session-1",
    });

    expect(preflight?.results).toHaveLength(1);
    expect(preflight?.results[0]).toMatchObject({
      kind: "browser_observation",
      status: "passed",
      passed: true,
    });
    expect(browserMocks.browserScreenshot).toHaveBeenCalledTimes(1);
    expect(listEvidence({ sessionId: "session-1" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "browser_snapshot",
          trustLevel: "host_observed",
          browserId: "agent:agent-1",
        }),
      ])
    );
    const evidenceId = preflight?.evidence[0]?.id ?? "";
    expect(evidenceId).toBeTruthy();

    const result = applyGoalUpdate(
      "agent-1",
      {
        status: "complete",
        finalSummary: "Browser preflight verified the local UI.",
        evidenceIds: [evidenceId],
      },
      { sessionId: "session-1" }
    );

    expect(result.accepted).toBe(true);
    expect(getGoal("agent-1")?.status).toBe("complete");
  });
});
