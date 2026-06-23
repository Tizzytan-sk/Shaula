import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { TeamTask } from "./types";
import { verifyTeamTasks } from "./verifier";

function task(patch: Partial<TeamTask>): TeamTask {
  return {
    id: "task-1",
    agentId: "agent-1",
    sessionId: "session-1",
    title: "Review auth policy",
    status: "completed",
    ownerType: "subagent",
    dependsOn: [],
    writePaths: [],
    requiredEvidence: ["subagent_result"],
    evidenceIds: ["evidence-1"],
    artifactRefs: [],
    source: { type: "subagent", id: "task-1", parentId: "batch-1" },
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function evidence(patch: Partial<EvidenceRef>): EvidenceRef {
  return {
    id: "evidence-1",
    kind: "subagent_result",
    title: "Subagent completed",
    sessionId: "session-1",
    agentId: "agent-1",
    textPreview: "Yes, this policy is allowed.",
    createdAt: 2,
    ...patch,
  };
}

describe("verifyTeamTasks", () => {
  it("warns when completed read-only team tasks conflict", () => {
    const result = verifyTeamTasks({
      tasks: [
        task({ id: "task-yes", evidenceIds: ["evidence-yes"] }),
        task({ id: "task-no", evidenceIds: ["evidence-no"] }),
      ],
      evidence: [
        evidence({
          id: "evidence-yes",
          textPreview: "Yes, this is allowed.",
        }),
        evidence({
          id: "evidence-no",
          textPreview: "No, this is not allowed.",
        }),
      ],
      verifiedAt: 10,
    });

    expect(result.status).toBe("warning");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cross-task-conflicts",
          status: "warning",
        }),
      ])
    );
  });

  it("fails when required strong evidence is only linked to weak task evidence", () => {
    const result = verifyTeamTasks({
      tasks: [
        task({
          requiredEvidence: ["test_result"],
          evidenceIds: ["subagent-claim"],
        }),
      ],
      evidence: [
        evidence({
          id: "subagent-claim",
          textPreview: "Tests passed.",
        }),
      ],
      verifiedAt: 10,
    });

    expect(result.status).toBe("failed");
    expect(result.missingEvidence).toEqual([
      "test_result (requires deterministic_check)",
    ]);
  });
});
