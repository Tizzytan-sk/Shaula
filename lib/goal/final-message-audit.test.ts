import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setExecutionContractStoreRootForTest,
} from "../execution-contract/store";
import { __resetEvidenceStoreForTest } from "../evidence/server-store";
import {
  __setWorkflowStoreRootForTest,
} from "../workflows/server-store";
import {
  __setGoalStoreRootForTest,
  addGoalEvidence,
  getGoal,
  setGoal,
} from "./file-store";
import {
  auditAndStoreGoalFinalMessage,
  auditGoalFinalMessage,
} from "./final-message-audit";
import { applyGoalUpdate } from "./update";

describe("final assistant message audit", () => {
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
  });

  afterEach(() => {
    __setGoalStoreRootForTest(null);
    __setWorkflowStoreRootForTest(null);
    __setExecutionContractStoreRootForTest(null);
    __resetEvidenceStoreForTest();
    rmSync(root, { recursive: true, force: true });
    rmSync(workflowRoot, { recursive: true, force: true });
    rmSync(contractRoot, { recursive: true, force: true });
  });

  it("passes when the actual final message matches the accepted claim and cited evidence", () => {
    const audit = auditGoalFinalMessage({
      claim: {
        finalSummary:
          "Implemented final message audit and npm test passed.",
        evidenceIds: ["test-proof"],
      },
      actualMessage: {
        text: "Implemented final message audit. npm test passed.",
        responseId: "resp-1",
        stopReason: "stop",
        endedAt: 2,
      },
      evidence: [
        {
          id: "test-proof",
          kind: "test_result",
          title: "npm test passed",
          createdAt: 1,
        },
      ],
      createdAt: 3,
    });

    expect(audit.status).toBe("passed");
    expect(audit.findings).toHaveLength(0);
  });

  it("fails an empty actual final message", () => {
    const audit = auditGoalFinalMessage({
      claim: {
        finalSummary: "Implemented final message audit.",
        evidenceIds: ["ev-1"],
      },
      actualMessage: {
        text: "   ",
        stopReason: "stop",
        endedAt: 2,
      },
      evidence: [
        {
          id: "ev-1",
          kind: "goal_evidence",
          title: "implementation diff",
          createdAt: 1,
        },
      ],
      createdAt: 3,
    });

    expect(audit.status).toBe("failed");
    expect(audit.findings.some((item) => item.severity === "failed")).toBe(true);
  });

  it("warns when the final message does not mention cited evidence signals", () => {
    const audit = auditGoalFinalMessage({
      claim: {
        finalSummary: "Implemented final message audit.",
        evidenceIds: ["browser-proof"],
      },
      actualMessage: {
        text: "Implemented final message audit.",
        stopReason: "stop",
        endedAt: 2,
      },
      evidence: [
        {
          id: "browser-proof",
          kind: "screenshot",
          title: "Browser screenshot captured",
          href: "C:/repo/artifacts/browser.png",
          createdAt: 1,
        },
      ],
      createdAt: 3,
    });

    expect(audit.status).toBe("warning");
    expect(audit.findings[0]?.evidenceIds).toEqual(["browser-proof"]);
  });

  it("stores one audit for the completed goal final message", () => {
    setGoal("agent-1", "Do the thing");
    addGoalEvidence("agent-1", {
      id: "test-proof",
      kind: "test",
      title: "npm test passed",
      createdAt: Date.now(),
    });
    const complete = applyGoalUpdate("agent-1", {
      status: "complete",
      finalSummary: "Implemented the change and npm test passed.",
      evidenceIds: ["test-proof"],
    });
    expect(complete.accepted).toBe(true);

    const result = auditAndStoreGoalFinalMessage("agent-1", {
      text: "Implemented the change. npm test passed.",
      responseId: "resp-1",
      stopReason: "stop",
      endedAt: Date.now(),
    });

    expect(result?.audit.status).toBe("passed");
    expect(getGoal("agent-1")?.lastFinalMessageAudit?.status).toBe("passed");
  });
});
