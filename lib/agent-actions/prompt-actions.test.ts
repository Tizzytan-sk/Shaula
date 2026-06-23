import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord } from "@/lib/agent-registry";
import { __resetEvidenceStoreForTest } from "@/lib/evidence/server-store";
import {
  __resetExecutionContractStoreForTest,
  __setExecutionContractStoreRootForTest,
} from "@/lib/execution-contract/store";
import { __setProgressRuntimeRootForTests } from "@/lib/progress/file-store";
import { __resetProgressStoreForTest } from "@/lib/progress/server-store";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import { __resetRuntimeEventStoreForTest } from "@/lib/runtime/event-store";
import {
  handlePromptPostAction,
  isPromptPostAction,
  parseImages,
  parseRouteOverride,
} from "./prompt-actions";

function fakeRecord(overrides: Partial<AgentRecord> = {}) {
  const prompts: Array<{ text: string; options: unknown }> = [];
  const steers: Array<{ text: string; images: unknown }> = [];
  const followUps: Array<{ text: string; images: unknown }> = [];
  const rec = {
    id: "agent-prompt-test",
    cwd: "C:/repo",
    isStreaming: true,
    events: [],
    nextSeq: 0,
    listeners: new Set<() => void>(),
    updatedAt: 1,
    session: {
      sessionId: "session-prompt-test",
      async prompt(text: string, options?: unknown) {
        prompts.push({ text, options });
      },
      async steer(text: string, images?: unknown) {
        steers.push({ text, images });
      },
      async followUp(text: string, images?: unknown) {
        followUps.push({ text, images });
      },
    },
    ...overrides,
  } as unknown as AgentRecord;
  return { rec, prompts, steers, followUps };
}

describe("prompt action helpers", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-prompt-actions-test-"));
    __setExecutionContractStoreRootForTest(tmpDir);
    __setProgressRuntimeRootForTests(tmpDir);
    __setRuntimeLedgerRootForTest(tmpDir);
    __resetExecutionContractStoreForTest();
    __resetProgressStoreForTest();
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
  });

  afterEach(() => {
    __resetExecutionContractStoreForTest();
    __resetProgressStoreForTest();
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
    __setExecutionContractStoreRootForTest(null);
    __setProgressRuntimeRootForTests(null);
    __setRuntimeLedgerRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies prompt-family POST actions", () => {
    expect(isPromptPostAction("prompt")).toBe(true);
    expect(isPromptPostAction("steer")).toBe(true);
    expect(isPromptPostAction("steering")).toBe(true);
    expect(isPromptPostAction("follow_up")).toBe(true);
    expect(isPromptPostAction("followUp")).toBe(true);
    expect(isPromptPostAction("goal_update")).toBe(false);
  });

  it("parses images and route overrides defensively", () => {
    expect(
      parseImages([
        { data: "abc", mimeType: "image/png" },
        { data: "skip" },
        null,
      ])
    ).toEqual([{ type: "image", data: "abc", mimeType: "image/png" }]);

    expect(
      parseRouteOverride({
        routeOverride: { route: "browser_task", reason: "Needs UI check" },
      })
    ).toEqual({ route: "browser_task", reason: "Needs UI check" });
    expect(parseRouteOverride({ route: "unknown" })).toBeUndefined();
  });

  it("sends streaming prompts as follow-up prompts with hidden attachment aside", async () => {
    const { rec, prompts } = fakeRecord();

    const result = await handlePromptPostAction({
      type: "prompt",
      agentId: rec.id,
      rec,
      body: {
        text: "Inspect this file",
        attachments: ["README.md"],
        images: [{ data: "abc", mimeType: "image/png" }],
      },
    });

    expect(result.body.ok).toBe(true);
    expect(result.body).not.toHaveProperty("contract");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.text).toContain("Inspect this file");
    expect(prompts[0]?.text).toContain("<<<CONTEXT_ASIDE>>>");
    expect(prompts[0]?.text).toContain("@README.md");
    expect(prompts[0]?.options).toMatchObject({
      streamingBehavior: "followUp",
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });

  it("uses the first attachment as the prompt contract main artifact", async () => {
    const { rec } = fakeRecord({ isStreaming: false });

    const result = await handlePromptPostAction({
      type: "prompt",
      agentId: rec.id,
      rec,
      body: {
        text: "Update this component",
        attachments: ["app/components/GoalTimeline.tsx"],
      },
    });

    expect(result.body.contract).toMatchObject({
      mainArtifact: {
        kind: "file",
        label: "app/components/GoalTimeline.tsx",
        source: "attachment",
      },
    });
    expect(result.body.progress).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          id: "main-artifact",
          status: "completed",
        }),
      ]),
    });
  });

  it("routes steer and follow-up through the corresponding session methods", async () => {
    const { rec, steers, followUps } = fakeRecord();

    await expect(
      handlePromptPostAction({
        type: "steering",
        agentId: rec.id,
        rec,
        body: { text: "interrupt" },
      })
    ).resolves.toEqual({ body: { ok: true } });

    await expect(
      handlePromptPostAction({
        type: "followUp",
        agentId: rec.id,
        rec,
        body: { text: "continue" },
      })
    ).resolves.toEqual({ body: { ok: true } });

    expect(steers).toEqual([{ text: "interrupt", images: undefined }]);
    expect(followUps).toEqual([{ text: "continue", images: undefined }]);
  });

  it("rejects missing prompt text", async () => {
    const { rec } = fakeRecord();

    await expect(
      handlePromptPostAction({
        type: "prompt",
        agentId: rec.id,
        rec,
        body: {},
      })
    ).resolves.toEqual({ body: { error: "text required" }, status: 400 });
  });
});
