import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord } from "@/lib/agent-registry";
import { appendEvidence, __resetEvidenceStoreForTest } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import {
  appendRuntimeEvent,
  __resetRuntimeEventStoreForTest,
} from "@/lib/runtime/event-store";
import type { RuntimeEvent } from "@/lib/runtime/events";
import {
  __resetTeamTaskStoreForTest,
  __setTeamTaskStoreRootForTest,
  upsertTeamTask,
} from "@/lib/team-state/server-store";
import {
  __resetTeamSynthesisAssistanceStoreForTest,
  __setTeamSynthesisAssistanceStoreRootForTest,
  putTeamSynthesisAssistance,
} from "@/lib/team-state/synthesis-assistance-store";
import {
  fingerprintTeamSynthesis,
  type TeamTaskSynthesisSummary,
} from "@/lib/team-state/synthesis";
import type { TeamTask, TeamTaskEvent } from "@/lib/team-state/types";
import {
  handleAgentQueryAction,
  isAgentQueryAction,
  mergeEvidenceRefs,
  mergeRuntimeEvents,
  parseEvidenceKind,
  parseEvidenceSourceType,
  parseEvidenceTrustLevel,
  parseRuntimeEventSource,
  parseRuntimeEventStatus,
} from "./query-actions";

function fakeRecord(overrides: Partial<AgentRecord> = {}) {
  const rec = {
    id: "agent-query-test",
    session: {
      sessionId: "session-query-test",
      model: {
        provider: "openai",
        id: "gpt-test",
        name: "GPT Test",
        contextWindow: 128_000,
      },
      thinkingLevel: "medium",
      getAllTools() {
        return [{ name: "shell" }, { name: "browser_open" }];
      },
      getActiveToolNames() {
        return ["shell"];
      },
      getAvailableThinkingLevels() {
        return ["low", "medium", "high"];
      },
      supportsThinking() {
        return true;
      },
      getUserMessagesForForking() {
        return [
          {
            id: "message-1",
            text:
              "Visible text\n<<<CONTEXT_ASIDE>>>\nhidden\n<<<END_CONTEXT_ASIDE>>>",
          },
        ];
      },
      getSessionStats() {
        return { messageCount: 3 };
      },
      getContextUsage() {
        return { usedTokens: 100, maxTokens: 128_000 };
      },
      sessionManager: {
        getTree() {
          return [{ id: "root" }];
        },
        getLeafId() {
          return "root";
        },
      },
      systemPrompt: "system",
    },
    ...overrides,
  } as unknown as AgentRecord;
  return rec;
}

function evidence(patch: Partial<EvidenceRef>): EvidenceRef {
  return {
    id: "evidence",
    kind: "log",
    title: "Evidence",
    createdAt: 1,
    ...patch,
  };
}

function event(patch: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    id: "event",
    source: "agent",
    type: "agent.event",
    payload: {},
    createdAt: 1,
    ...patch,
  };
}

function teamTask(patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id: "subagent:batch-1:task-1",
    agentId: "agent-query-test",
    sessionId: "session-query-test",
    batchId: "batch-1",
    title: "Review files",
    status: "completed",
    ownerType: "subagent",
    ownerId: "child-1",
    dependsOn: [],
    writePaths: [],
    requiredEvidence: ["subagent_result"],
    evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
    artifactRefs: [],
    source: { type: "subagent", id: "task-1", parentId: "batch-1" },
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function teamTaskEvent(patch: Partial<TeamTaskEvent> = {}): TeamTaskEvent {
  return {
    id: "team-task-event-1",
    taskId: "subagent:batch-1:task-1",
    agentId: "agent-query-test",
    sessionId: "session-query-test",
    type: "evidence_linked",
    status: "completed",
    evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
    createdAt: 2,
    ...patch,
  };
}

describe("query action helpers", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-query-actions-test-"));
    __setRuntimeLedgerRootForTest(tmpDir);
    __setTeamTaskStoreRootForTest(tmpDir);
    __setTeamSynthesisAssistanceStoreRootForTest(tmpDir);
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
    __resetTeamTaskStoreForTest();
    __resetTeamSynthesisAssistanceStoreForTest();
  });

  afterEach(() => {
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
    __resetTeamTaskStoreForTest();
    __resetTeamSynthesisAssistanceStoreForTest();
    __setTeamTaskStoreRootForTest(null);
    __setTeamSynthesisAssistanceStoreRootForTest(null);
    __setRuntimeLedgerRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies only explicit GET query actions", () => {
    expect(isAgentQueryAction("get_tools")).toBe(true);
    expect(isAgentQueryAction("runtime_events")).toBe(true);
    expect(isAgentQueryAction("evidence")).toBe(true);
    expect(isAgentQueryAction("prompt")).toBe(false);
    expect(isAgentQueryAction(null)).toBe(false);
  });

  it("parses known query filters defensively", () => {
    expect(parseRuntimeEventSource("browser")).toBe("browser");
    expect(parseRuntimeEventSource("bad")).toBeUndefined();
    expect(parseRuntimeEventStatus("running")).toBe("running");
    expect(parseRuntimeEventStatus("bad")).toBeUndefined();
    expect(parseEvidenceKind("verification_result")).toBe("verification_result");
    expect(parseEvidenceKind("bad")).toBeUndefined();
    expect(parseEvidenceTrustLevel("host_observed")).toBe("host_observed");
    expect(parseEvidenceTrustLevel("bad")).toBeUndefined();
    expect(parseEvidenceSourceType("system")).toBe("system");
    expect(parseEvidenceSourceType("bad")).toBeUndefined();
  });

  it("merges evidence and runtime events by stable id then created time", () => {
    expect(
      mergeEvidenceRefs(
        [evidence({ id: "same", title: "Old", createdAt: 2 })],
        [
          evidence({ id: "earlier", title: "Earlier", createdAt: 1 }),
          evidence({ id: "same", title: "New", createdAt: 2 }),
        ]
      ).map((item) => [item.id, item.title])
    ).toEqual([
      ["earlier", "Earlier"],
      ["same", "New"],
    ]);

    expect(
      mergeRuntimeEvents(
        [event({ id: "same", type: "old", createdAt: 2 })],
        [
          event({ id: "earlier", type: "earlier", createdAt: 1 }),
          event({ id: "same", type: "new", createdAt: 2 }),
        ]
      ).map((item) => [item.id, item.type])
    ).toEqual([
      ["earlier", "earlier"],
      ["same", "new"],
    ]);
  });

  it("reads session-backed query payloads without exposing hidden context asides", async () => {
    const rec = fakeRecord();
    const url = new URL("http://localhost/api/agent/agent-query-test");

    await expect(
      handleAgentQueryAction({
        action: "get_tools",
        agentId: rec.id,
        rec,
        url,
      })
    ).resolves.toEqual({
      body: {
        tools: [{ name: "shell" }, { name: "browser_open" }],
        active: ["shell"],
      },
    });

    const messages = await handleAgentQueryAction({
      action: "user_messages_for_forking",
      agentId: rec.id,
      rec,
      url,
    });
    expect(messages.body).toEqual({
      messages: [{ id: "message-1", text: "Visible text" }],
    });

    const stats = await handleAgentQueryAction({
      action: "stats",
      agentId: rec.id,
      rec,
      url,
    });
    expect(stats.body).toMatchObject({
      stats: { messageCount: 3 },
      contextUsage: { usedTokens: 100, maxTokens: 128_000 },
      contextWindow: 128_000,
      model: { provider: "openai", id: "gpt-test", name: "GPT Test" },
    });
  });

  it("merges runtime and evidence results across agent and session ownership", async () => {
    const rec = fakeRecord();
    appendRuntimeEvent(
      event({
        id: "agent-event",
        agentId: rec.id,
        source: "browser",
        status: "done",
        createdAt: 2,
      })
    );
    appendRuntimeEvent(
      event({
        id: "session-event",
        sessionId: rec.session.sessionId,
        source: "browser",
        status: "done",
        createdAt: 1,
      })
    );
    appendEvidence(
      evidence({
        id: "agent-evidence",
        agentId: rec.id,
        kind: "browser_step",
        browserId: "agent:agent-query-test",
        createdAt: 2,
      })
    );
    appendEvidence(
      evidence({
        id: "session-evidence",
        sessionId: rec.session.sessionId,
        kind: "browser_step",
        browserId: "agent:agent-query-test",
        createdAt: 1,
      })
    );

    const events = await handleAgentQueryAction({
      action: "runtime_events",
      agentId: rec.id,
      rec,
      url: new URL(
        "http://localhost/api/agent/agent-query-test?action=runtime_events&source=browser&status=done"
      ),
    });
    expect((events.body.events as RuntimeEvent[]).map((item) => item.id)).toEqual([
      "session-event",
      "agent-event",
    ]);

    const evidenceResult = await handleAgentQueryAction({
      action: "evidence",
      agentId: rec.id,
      rec,
      url: new URL(
        "http://localhost/api/agent/agent-query-test?action=evidence&kind=browser_step&sourceType=browser"
      ),
    });
    expect(
      (evidenceResult.body.evidence as EvidenceRef[]).map((item) => item.id)
    ).toEqual(["session-evidence", "agent-evidence"]);
  });

  it("returns team task state in the goal timeline payload", async () => {
    const rec = fakeRecord();
    upsertTeamTask({
      task: teamTask(),
      event: teamTaskEvent(),
    });
    appendEvidence(
      evidence({
        id: "subagent-result:batch-1:task-1:child-1",
        kind: "subagent_result",
        agentId: rec.id,
        title: "Subagent completed: Review files",
        summary: "Reviewed files and found no blocking issue.",
        source: { type: "subagent", id: "child-1", parentId: "batch-1" },
        createdAt: 2,
      })
    );

    const result = await handleAgentQueryAction({
      action: "goal_timeline",
      agentId: rec.id,
      rec,
      url: new URL("http://localhost/api/agent/agent-query-test?action=goal_timeline"),
    });

    expect(result.body).toMatchObject({
      teamTasks: [
        expect.objectContaining({
          id: "subagent:batch-1:task-1",
          status: "completed",
          evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
        }),
      ],
      teamTaskSynthesis: expect.objectContaining({
        status: "ready",
        headline: expect.stringContaining("conclusions"),
        evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
        items: [
          expect.objectContaining({
            kind: "conclusion",
            title: "Review files",
          }),
        ],
      }),
    });

    const synthesis = result.body.teamTaskSynthesis as TeamTaskSynthesisSummary;
    putTeamSynthesisAssistance({
      agentId: rec.id,
      fingerprint: fingerprintTeamSynthesis(synthesis),
      assistance: {
        status: "accepted",
        source: "llm_assisted",
        generatedAt: 10,
        headline: "Cached Team assist",
        summary: "Only cites the known Team task and evidence.",
        itemIds: ["task:subagent:batch-1:task-1"],
        taskIds: ["subagent:batch-1:task-1"],
        evidenceIds: ["subagent-result:batch-1:task-1:child-1"],
        warnings: [],
      },
      model: { provider: "openai", id: "gpt-test" },
      latencyMs: 25,
      tokenCount: 8,
      createdAt: 10,
      updatedAt: 10,
    });

    const cached = await handleAgentQueryAction({
      action: "goal_timeline",
      agentId: rec.id,
      rec,
      url: new URL("http://localhost/api/agent/agent-query-test?action=goal_timeline"),
    });
    expect(cached.body).toMatchObject({
      teamTaskSynthesis: expect.objectContaining({
        assistance: expect.objectContaining({
          status: "accepted",
          headline: "Cached Team assist",
          meta: expect.objectContaining({
            cached: true,
            model: { provider: "openai", id: "gpt-test" },
            latencyMs: 25,
            tokenCount: 8,
          }),
        }),
      }),
    });
  });
});
