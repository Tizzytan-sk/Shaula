import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTeamTaskStoreForTest,
  __setTeamTaskStoreRootForTest,
  listTeamTaskEvents,
  listTeamTasks,
  upsertTeamTask,
} from "./server-store";
import type { TeamTask, TeamTaskEvent } from "./types";

function task(patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id: "subagent:batch-1:task-1",
    agentId: "agent-1",
    sessionId: "session-1",
    batchId: "batch-1",
    title: "Review files",
    status: "running",
    ownerType: "subagent",
    ownerId: "child-1",
    dependsOn: [],
    writePaths: [],
    requiredEvidence: [],
    evidenceIds: [],
    artifactRefs: [],
    source: { type: "subagent", id: "task-1", parentId: "batch-1" },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function event(patch: Partial<TeamTaskEvent> = {}): TeamTaskEvent {
  return {
    id: "event-1",
    taskId: "subagent:batch-1:task-1",
    agentId: "agent-1",
    sessionId: "session-1",
    type: "task_created",
    status: "running",
    createdAt: 1,
    ...patch,
  };
}

describe("team-state server store", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-team-state-test-"));
    __setTeamTaskStoreRootForTest(tmpDir);
  });

  afterEach(() => {
    __resetTeamTaskStoreForTest();
    __setTeamTaskStoreRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists and hydrates team tasks by agent", () => {
    upsertTeamTask({
      task: task({ evidenceIds: ["evidence-1"], updatedAt: 2 }),
      event: event({ evidenceIds: ["evidence-1"], createdAt: 2 }),
    });

    expect(listTeamTasks({ agentId: "agent-1" })).toHaveLength(1);

    __setTeamTaskStoreRootForTest(tmpDir);

    expect(listTeamTasks({ agentId: "agent-1" })).toEqual([
      expect.objectContaining({
        id: "subagent:batch-1:task-1",
        evidenceIds: ["evidence-1"],
      }),
    ]);
    expect(listTeamTaskEvents({ agentId: "agent-1" })).toEqual([
      expect.objectContaining({ id: "event-1", evidenceIds: ["evidence-1"] }),
    ]);
  });

  it("merges repeated updates without duplicating append-only events", () => {
    upsertTeamTask({
      task: task({ evidenceIds: ["evidence-1"], updatedAt: 2 }),
      event: event({ id: "event-1", evidenceIds: ["evidence-1"], createdAt: 2 }),
    });
    upsertTeamTask({
      task: task({
        status: "completed",
        evidenceIds: ["evidence-1", "evidence-2"],
        artifactRefs: ["session.jsonl"],
        updatedAt: 3,
      }),
      event: event({
        id: "event-1",
        status: "completed",
        evidenceIds: ["evidence-2"],
        createdAt: 3,
      }),
    });

    expect(listTeamTasks({ agentId: "agent-1" })).toEqual([
      expect.objectContaining({
        status: "completed",
        evidenceIds: ["evidence-1", "evidence-2"],
        artifactRefs: ["session.jsonl"],
      }),
    ]);
    expect(listTeamTaskEvents({ agentId: "agent-1" })).toHaveLength(1);
  });
});
