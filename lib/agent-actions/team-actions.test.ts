import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord } from "@/lib/agent-registry";
import { appendEvidence, __resetEvidenceStoreForTest } from "@/lib/evidence/server-store";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import {
  __resetTeamTaskStoreForTest,
  __setTeamTaskStoreRootForTest,
  upsertTeamTask,
} from "@/lib/team-state/server-store";
import {
  __resetTeamSynthesisAssistanceStoreForTest,
  __setTeamSynthesisAssistanceStoreRootForTest,
} from "@/lib/team-state/synthesis-assistance-store";
import type { TeamTask, TeamTaskEvent } from "@/lib/team-state/types";
import { handleTeamPostAction, isTeamPostAction } from "./team-actions";

function fakeRecord(): AgentRecord {
  return {
    id: "agent-team-action",
    session: {
      sessionId: "session-team-action",
      model: {
        provider: "openai",
        id: "gpt-test",
        name: "GPT Test",
        baseUrl: "https://example.test/v1",
      },
    },
  } as unknown as AgentRecord;
}

function task(patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id: "team-task-1",
    agentId: "agent-team-action",
    sessionId: "session-team-action",
    title: "Review auth boundary",
    status: "warning",
    ownerType: "subagent",
    ownerId: "child-auth",
    dependsOn: [],
    writePaths: [],
    requiredEvidence: ["subagent_result"],
    evidenceIds: ["team-evidence-1"],
    artifactRefs: [],
    blockedBy: "Needs parent synthesis before completion.",
    source: { type: "subagent", id: "child-auth", parentId: "batch-1" },
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function event(patch: Partial<TeamTaskEvent> = {}): TeamTaskEvent {
  return {
    id: "team-task-event-1",
    taskId: "team-task-1",
    agentId: "agent-team-action",
    sessionId: "session-team-action",
    type: "evidence_linked",
    status: "warning",
    evidenceIds: ["team-evidence-1"],
    createdAt: 2,
    ...patch,
  };
}

function setupTeamState() {
  upsertTeamTask({ task: task(), event: event() });
  appendEvidence({
    id: "team-evidence-1",
    kind: "subagent_result",
    title: "Auth reviewer warning",
    agentId: "agent-team-action",
    sessionId: "session-team-action",
    summary: "Auth boundary still needs parent synthesis.",
    source: { type: "subagent", id: "child-auth" },
    createdAt: 2,
  });
}

describe("team actions", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-team-actions-test-"));
    __setRuntimeLedgerRootForTest(tmpDir);
    __setTeamTaskStoreRootForTest(tmpDir);
    __setTeamSynthesisAssistanceStoreRootForTest(tmpDir);
    __resetEvidenceStoreForTest();
    __resetTeamTaskStoreForTest();
    __resetTeamSynthesisAssistanceStoreForTest();
  });

  afterEach(() => {
    __resetEvidenceStoreForTest();
    __resetTeamTaskStoreForTest();
    __resetTeamSynthesisAssistanceStoreForTest();
    __setTeamTaskStoreRootForTest(null);
    __setTeamSynthesisAssistanceStoreRootForTest(null);
    __setRuntimeLedgerRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies explicit Team POST actions", () => {
    expect(isTeamPostAction("team_synthesis_assist")).toBe(true);
    expect(isTeamPostAction("goal_timeline")).toBe(false);
  });

  it("runs provider-backed assistance once and then serves the cached result", async () => {
    setupTeamState();
    const rec = fakeRecord();
    let calls = 0;
    const result = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async ({ prompt }) => {
        calls += 1;
        expect(prompt).toContain("Do not treat synthesis text as test_result");
        return {
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "Auth warning still needs parent synthesis.",
                summary:
                  "The Team result remains warning-level and cites the known auth task and evidence.",
                itemIds: ["task:team-task-1", "check:warning-team-tasks"],
                taskIds: ["team-task-1"],
                evidenceIds: ["team-evidence-1"],
              }),
            },
          ],
          stopReason: "stop",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: 3,
        };
      },
    });

    expect(result.body).toMatchObject({
      ok: true,
      cached: false,
      assistance: {
        status: "accepted",
        evidenceIds: ["team-evidence-1"],
        meta: {
          cached: false,
          model: { provider: "openai", id: "gpt-test" },
          tokenCount: 2,
          estimatedCost: 0,
        },
      },
    });

    const cached = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async () => {
        throw new Error("should not call model when cache is fresh");
      },
    });

    expect(calls).toBe(1);
    expect(cached.body).toMatchObject({
      ok: true,
      cached: true,
      assistance: {
        status: "accepted",
        meta: {
          cached: true,
          model: { provider: "openai", id: "gpt-test" },
          tokenCount: 2,
        },
      },
    });

    const refreshed = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: { force: true },
      callModel: async () => {
        calls += 1;
        return {
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "Refreshed auth warning.",
                summary:
                  "The refreshed assist still cites only the known task and evidence.",
                itemIds: ["task:team-task-1", "check:warning-team-tasks"],
                taskIds: ["team-task-1"],
                evidenceIds: ["team-evidence-1"],
              }),
            },
          ],
          stopReason: "stop",
          usage: {
            input: 2,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 4,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: 4,
        };
      },
    });

    expect(calls).toBe(2);
    expect(refreshed.body).toMatchObject({
      ok: true,
      cached: false,
      assistance: {
        headline: "Refreshed auth warning.",
        meta: { cached: false, tokenCount: 4 },
      },
    });
  });

  it("returns user-facing provider errors without updating the cache", async () => {
    setupTeamState();
    const rec = fakeRecord();
    const result = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async () => {
        throw new Error('No API key or OAuth token found for "openai"');
      },
    });

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({
      error: "当前 provider 的 API key 或 OAuth 凭证缺失、过期或被拒绝。修复凭证后再试。",
      rawError: 'No API key or OAuth token found for "openai"',
      userError: {
        code: "missing_credential",
        title: "模型凭证不可用",
        actionLabel: "去设置",
        retryable: true,
      },
    });
  });

  it("returns a retryable user-facing error when the model omits JSON", async () => {
    setupTeamState();
    const rec = fakeRecord();
    const result = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async () =>
        ({
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          content: [{ type: "text", text: "looks good to me" }],
          stopReason: "stop",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: 3,
        }) as never,
    });

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      error: "Team assist 需要模型返回 JSON。缓存没有更新，你可以重试或切换模型。",
      userError: {
        code: "invalid_model_output",
        title: "模型输出格式不对",
        actionLabel: "重试",
        retryable: true,
      },
    });
  });

  it("sanitizes bad model output before caching", async () => {
    setupTeamState();
    const rec = fakeRecord();
    const result = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: { force: true },
      callModel: async () =>
        ({
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ready",
                headline: "All clear.",
                summary: "Invented test evidence says it passed.",
                itemIds: [],
                taskIds: ["invented-task"],
                evidenceIds: ["invented-test-evidence"],
              }),
            },
          ],
          stopReason: "stop",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: 3,
        }) as never,
    });

    expect(result.body).toMatchObject({
      ok: true,
      cached: false,
      assistance: { status: "rejected", evidenceIds: [] },
    });
    expect(
      ((result.body.assistance as { warnings?: string[] }).warnings ?? []).join("\n")
    ).toContain("Ignored draft status");
  });
});
