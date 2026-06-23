import { describe, expect, it, vi } from "vitest";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { TeamTask, TeamTaskUpdate } from "@/lib/team-state/types";
import type { RuntimeEvent } from "./events";
import { mirrorAgentEventToRuntimeLedger } from "./agent-event-mirror";

const ctx = {
  agentId: "agent-1",
  sessionId: "session-1",
  sessionPath: "C:/sessions/session-1.jsonl",
  cwd: "C:/repo",
  seq: 7,
};

function evidenceRef(id: string): EvidenceRef {
  return {
    id,
    kind: "progress_artifact",
    title: "Artifact",
    sessionId: "session-1",
    agentId: "agent-1",
    createdAt: 1,
  };
}

function runtimeEvent(id = "event-1"): RuntimeEvent {
  return {
    id,
    source: "progress",
    type: "progress.updated",
    status: "running",
    sessionId: "session-1",
    agentId: "agent-1",
    payload: { ok: true },
    createdAt: 2,
  };
}

function teamTask(id = "team-task-1"): TeamTask {
  return {
    id,
    agentId: "agent-1",
    sessionId: "session-1",
    title: "Review task",
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
  };
}

describe("mirrorAgentEventToRuntimeLedger", () => {
  it("bridges agent events, persists evidence, and appends the runtime event", () => {
    const rawEvidence = evidenceRef("evidence-1");
    const persistedEvidence = {
      ...rawEvidence,
      updatedAt: 3,
    };
    const event = runtimeEvent();
    const bridgeAgentEventToRuntime = vi.fn(() => ({
      event,
      evidence: [rawEvidence],
    }));
    const appendEvidenceMany = vi.fn(() => [persistedEvidence]);
    const appendedEvents: RuntimeEvent[] = [];
    const derivedUpdates: TeamTaskUpdate[] = [
      {
        task: teamTask(),
        event: {
          id: "team-event-1",
          taskId: "team-task-1",
          agentId: "agent-1",
          type: "evidence_linked",
          evidenceIds: ["evidence-1"],
          createdAt: 3,
        },
      },
    ];
    const appendRuntimeEvent = <TPayload>(
      item: RuntimeEvent<TPayload>
    ): RuntimeEvent<TPayload> => {
      appendedEvents.push(item as RuntimeEvent);
      return {
        ...item,
        updatedAt: 4,
      };
    };
    const deriveTeamTaskUpdates = vi.fn(() => derivedUpdates);
    const upsertTeamTasks = vi.fn(() => [teamTask()]);

    const result = mirrorAgentEventToRuntimeLedger(ctx, { type: "progress_updated" }, {
      bridgeAgentEventToRuntime,
      appendEvidenceMany,
      appendRuntimeEvent,
      deriveTeamTaskUpdates,
      upsertTeamTasks,
    });

    expect(bridgeAgentEventToRuntime).toHaveBeenCalledWith(ctx, {
      type: "progress_updated",
    });
    expect(appendEvidenceMany).toHaveBeenCalledWith([rawEvidence]);
    expect(appendedEvents).toEqual([{
      ...event,
      evidence: [persistedEvidence],
    }]);
    expect(deriveTeamTaskUpdates).toHaveBeenCalledWith(
      ctx,
      { type: "progress_updated" },
      [persistedEvidence]
    );
    expect(upsertTeamTasks).toHaveBeenCalledWith(derivedUpdates);
    expect(result).toEqual({
      status: "mirrored",
      event: { ...event, evidence: [persistedEvidence], updatedAt: 4 },
      evidence: [persistedEvidence],
      teamTasks: [teamTask()],
    });
  });

  it("does not append anything when the bridge skips an event", () => {
    const appendEvidenceMany = vi.fn();
    const appendedEvents: RuntimeEvent[] = [];
    const appendRuntimeEvent = <TPayload>(
      item: RuntimeEvent<TPayload>
    ): RuntimeEvent<TPayload> => {
      appendedEvents.push(item as RuntimeEvent);
      return item;
    };

    const result = mirrorAgentEventToRuntimeLedger(ctx, { type: "message_update" }, {
      bridgeAgentEventToRuntime: () => null,
      appendEvidenceMany,
      appendRuntimeEvent,
    });

    expect(result).toEqual({ status: "skipped" });
    expect(appendEvidenceMany).not.toHaveBeenCalled();
    expect(appendedEvents).toEqual([]);
  });

  it("catches mirror errors and reports them without throwing", () => {
    const err = new Error("store failed");
    const onError = vi.fn();

    const result = mirrorAgentEventToRuntimeLedger(ctx, { type: "agent_start" }, {
      bridgeAgentEventToRuntime: () => ({
        event: runtimeEvent("event-error"),
        evidence: [],
      }),
      appendEvidenceMany: () => {
        throw err;
      },
      onError,
    });

    expect(result).toEqual({ status: "failed", error: err });
    expect(onError).toHaveBeenCalledWith(err);
  });
});
