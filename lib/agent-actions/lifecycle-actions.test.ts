import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord, RingBufferEvent } from "@/lib/agent-registry";
import { __resetEvidenceStoreForTest } from "@/lib/evidence/server-store";
import { __setProgressRuntimeRootForTests } from "@/lib/progress/file-store";
import {
  __resetProgressStoreForTest,
  updateProgress,
} from "@/lib/progress/server-store";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import { __resetRuntimeEventStoreForTest } from "@/lib/runtime/event-store";
import {
  __resetWorkflowStoreForTest,
  __setWorkflowStoreRootForTest,
} from "@/lib/workflows/server-store";
import {
  handleLifecyclePostAction,
  isLifecyclePostAction,
} from "./lifecycle-actions";

function fakeRecord(overrides: Partial<AgentRecord> = {}) {
  const calls = {
    abort: 0,
    abortCompaction: 0,
    compact: [] as Array<string | undefined>,
    navigateTree: [] as Array<{ targetId: string; options: unknown }>,
  };
  const rec = {
    id: "agent-lifecycle-test",
    cwd: "C:/repo",
    events: [] as Array<{ seq: number; event: RingBufferEvent } | undefined>,
    nextSeq: 0,
    listeners: new Set<() => void>(),
    isStreaming: true,
    isPromptStarting: true,
    updatedAt: 1,
    session: {
      sessionId: "session-lifecycle-test",
      sessionFile: "C:/repo/session.json",
      async abort() {
        calls.abort += 1;
      },
      abortCompaction() {
        calls.abortCompaction += 1;
      },
      async compact(customInstructions?: string) {
        calls.compact.push(customInstructions);
        return { summary: customInstructions ?? "default" };
      },
      async navigateTree(targetId: string, options: unknown) {
        calls.navigateTree.push({ targetId, options });
        return { targetId, options };
      },
    },
    ...overrides,
  } as unknown as AgentRecord;
  return { rec, calls };
}

describe("lifecycle action helpers", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-lifecycle-actions-test-"));
    __setRuntimeLedgerRootForTest(tmpDir);
    __setProgressRuntimeRootForTests(tmpDir);
    __setWorkflowStoreRootForTest(tmpDir);
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
    __resetProgressStoreForTest();
  });

  afterEach(() => {
    __resetEvidenceStoreForTest();
    __resetRuntimeEventStoreForTest();
    __resetProgressStoreForTest();
    __resetWorkflowStoreForTest();
    __setWorkflowStoreRootForTest(null);
    __setProgressRuntimeRootForTests(null);
    __setRuntimeLedgerRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies lifecycle POST actions", () => {
    expect(isLifecyclePostAction("abort")).toBe(true);
    expect(isLifecyclePostAction("abort_compaction")).toBe(true);
    expect(isLifecyclePostAction("abortCompaction")).toBe(true);
    expect(isLifecyclePostAction("compact")).toBe(true);
    expect(isLifecyclePostAction("navigate_tree")).toBe(true);
    expect(isLifecyclePostAction("navigateTree")).toBe(true);
    expect(isLifecyclePostAction("prompt")).toBe(false);
  });

  it("aborts SDK sessions, fails open progress, and marks the record idle", async () => {
    const { rec, calls } = fakeRecord();
    updateProgress(rec.id, {
      steps: [{ id: "step-1", title: "Running", status: "running" }],
      replaceSteps: true,
    });

    const result = await handleLifecyclePostAction({
      type: "abort",
      agentId: rec.id,
      rec,
      body: {},
    });

    expect(calls.abort).toBe(1);
    expect(rec.isStreaming).toBe(false);
    expect(rec.isPromptStarting).toBe(false);
    expect(rec.updatedAt).toEqual(expect.any(Number));
    expect(rec.nextSeq).toBe(1);
    expect(rec.events[0]?.event.type).toBe("progress_updated");
    expect(result.body.ok).toBe(true);
    expect(
      (
        result.body.progress as {
          steps: Array<{ id: string; status: string; summary?: string }>;
        }
      ).steps
    ).toMatchObject([
      {
        id: "step-1",
        status: "failed",
        summary: "用户已中止当前任务。",
      },
    ]);
  });

  it("forwards compaction lifecycle calls to the session", async () => {
    const { rec, calls } = fakeRecord();

    await expect(
      handleLifecyclePostAction({
        type: "abortCompaction",
        agentId: rec.id,
        rec,
        body: {},
      })
    ).resolves.toEqual({ body: { ok: true } });
    expect(calls.abortCompaction).toBe(1);

    await expect(
      handleLifecyclePostAction({
        type: "compact",
        agentId: rec.id,
        rec,
        body: { customInstructions: "summarize decisions" },
      })
    ).resolves.toEqual({
      body: {
        ok: true,
        result: { summary: "summarize decisions" },
      },
    });
    expect(calls.compact).toEqual(["summarize decisions"]);
  });

  it("validates and forwards navigate_tree requests", async () => {
    const { rec, calls } = fakeRecord();

    await expect(
      handleLifecyclePostAction({
        type: "navigate_tree",
        agentId: rec.id,
        rec,
        body: {},
      })
    ).resolves.toEqual({
      body: { error: "targetId required" },
      status: 400,
    });

    const result = await handleLifecyclePostAction({
      type: "navigateTree",
      agentId: rec.id,
      rec,
      body: {
        targetId: "node-2",
        summarize: true,
        customInstructions: "keep tests",
        replaceInstructions: false,
        label: "branch",
      },
    });

    expect(result.body.ok).toBe(true);
    expect(calls.navigateTree).toEqual([
      {
        targetId: "node-2",
        options: {
          summarize: true,
          customInstructions: "keep tests",
          replaceInstructions: false,
          label: "branch",
        },
      },
    ]);
  });
});
