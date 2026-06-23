import { describe, expect, it } from "vitest";
import type { AgentEventBridgeContext } from "@/lib/runtime/agent-event-bridge";
import type { EvidenceRef } from "@/lib/evidence/types";
import { deriveTeamTaskUpdatesFromAgentEvent } from "./event-adapter";

const ctx: AgentEventBridgeContext = {
  agentId: "agent-1",
  sessionId: "session-1",
  sessionPath: "/tmp/session.jsonl",
  cwd: "/repo",
  seq: 11,
};

function evidence(patch: Partial<EvidenceRef>): EvidenceRef {
  return {
    id: "evidence",
    kind: "subagent_result",
    title: "Evidence",
    sessionId: "session-1",
    agentId: "agent-1",
    createdAt: 1,
    ...patch,
  };
}

describe("deriveTeamTaskUpdatesFromAgentEvent", () => {
  it("creates bounded team tasks for subagent batch start events", () => {
    const updates = deriveTeamTaskUpdatesFromAgentEvent(ctx, {
      type: "subagent_batch_start",
      batch: {
        id: "batch-1",
        parentAgentId: "agent-1",
        status: "running",
        reason: "Parallel review",
        tasks: [
          {
            id: "task-1",
            title: "Review API",
            prompt: "Only inspect API files.",
            status: "pending",
            writePaths: ["lib/api"],
          },
        ],
        createdAt: 1,
      },
    }, []);

    expect(updates).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({
          id: "subagent:batch-1:task-1",
          status: "pending",
          writePaths: ["lib/api"],
          contextPacket: expect.objectContaining({
            taskTitle: "Review API",
            writePaths: ["lib/api"],
          }),
        }),
      }),
    ]);
  });

  it("links subagent results to real evidence ids without inventing test evidence", () => {
    const updates = deriveTeamTaskUpdatesFromAgentEvent(ctx, {
      type: "subagent_batch_end",
      batchId: "batch-1",
      status: "completed",
      endedAt: 3,
      results: [
        {
          taskId: "task-1",
          agentId: "child-1",
          status: "completed",
          answer: "Looks good.",
          startedAt: 1,
          endedAt: 3,
          sessionFile: "/tmp/child.jsonl",
        },
      ],
    }, [
      evidence({
        id: "subagent-result:batch-1:task-1:child-1",
        taskId: "task-1",
        metadata: { childAgentId: "child-1" },
      }),
    ]);

    expect(updates).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({
          status: "completed",
          evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
          requiredEvidence: ["subagent_result"],
          artifactRefs: ["/tmp/child.jsonl"],
        }),
      }),
    ]);
    expect(updates[0].task.requiredEvidence).not.toContain("test_result");
    expect(updates[0].task.requiredEvidence).not.toContain("browser_observation");
  });

  it("links workflow artifacts to workflow team task state", () => {
    const updates = deriveTeamTaskUpdatesFromAgentEvent(ctx, {
      type: "workflow_artifact",
      workflowId: "wf-1",
      artifact: { name: "review.json", value: { ok: true }, createdAt: 5 },
    }, [
      evidence({
        id: "workflow-artifact:wf-1:review.json",
        kind: "workflow_artifact",
        workflowId: "wf-1",
      }),
    ]);

    expect(updates).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({
          id: "workflow:wf-1",
          workflowId: "wf-1",
          status: "running",
          evidenceIds: ["workflow-artifact:wf-1:review.json"],
          artifactRefs: ["review.json"],
          requiredEvidence: ["workflow_artifact"],
        }),
      }),
    ]);
  });
});
