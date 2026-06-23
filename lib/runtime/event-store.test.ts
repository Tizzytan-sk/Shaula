import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import {
  __resetRuntimeEventStoreForTest,
  appendRuntimeEvent,
  getRuntimeEvent,
  listRuntimeEvents,
} from "./event-store";

describe("runtime event store", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-runtime-event-test-"));
    __setRuntimeLedgerRootForTest(tmpDir);
    __resetRuntimeEventStoreForTest();
  });

  afterEach(() => {
    __resetRuntimeEventStoreForTest();
    __setRuntimeLedgerRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends and lists runtime events by source and owner", () => {
    appendRuntimeEvent({
      id: "progress-1",
      source: "progress",
      type: "progress.update",
      status: "running",
      sessionId: "session-1",
      agentId: "agent-1",
      payload: { steps: 1 },
      createdAt: 2,
    });
    appendRuntimeEvent({
      id: "browser-1",
      source: "browser",
      type: "browser.open",
      status: "done",
      sessionId: "session-1",
      browserId: "agent:agent-1",
      payload: { url: "http://localhost:3000" },
      createdAt: 1,
    });

    expect(listRuntimeEvents({ sessionId: "session-1" }).map((e) => e.id)).toEqual([
      "browser-1",
      "progress-1",
    ]);
    expect(listRuntimeEvents({ source: "browser" })).toHaveLength(1);
    expect(listRuntimeEvents({ status: "running" })).toHaveLength(1);
  });

  it("upserts stable events", () => {
    appendRuntimeEvent({
      id: "event-1",
      source: "approval",
      type: "approval.request",
      status: "running",
      payload: {},
      createdAt: 1,
    });
    appendRuntimeEvent({
      id: "event-1",
      source: "approval",
      type: "approval.decision",
      status: "done",
      payload: { decision: "denied" },
      createdAt: 1,
      updatedAt: 2,
    });

    expect(listRuntimeEvents()).toHaveLength(1);
    expect(getRuntimeEvent("event-1")).toMatchObject({
      type: "approval.decision",
      status: "done",
      updatedAt: 2,
    });
  });

  it("rehydrates session events from the runtime ledger", () => {
    appendRuntimeEvent({
      id: "persisted-event",
      source: "agent",
      type: "agent.started",
      status: "running",
      sessionId: "session-persist",
      agentId: "agent-1",
      payload: { phase: "first" },
      createdAt: 1,
    });
    appendRuntimeEvent({
      id: "persisted-event",
      source: "agent",
      type: "agent.finished",
      status: "done",
      sessionId: "session-persist",
      agentId: "agent-1",
      payload: { phase: "done" },
      createdAt: 1,
      updatedAt: 2,
    });

    __resetRuntimeEventStoreForTest();

    expect(listRuntimeEvents({ sessionId: "session-persist" })).toHaveLength(1);
    expect(getRuntimeEvent("persisted-event")).toMatchObject({
      type: "agent.finished",
      status: "done",
      payload: { phase: "done" },
      updatedAt: 2,
    });
  });

  it("keeps only the most recent runtime events", () => {
    for (let i = 0; i < 5005; i += 1) {
      appendRuntimeEvent({
        id: `event-${i}`,
        source: "agent",
        type: "agent.event",
        payload: {},
        createdAt: i,
      });
    }

    const events = listRuntimeEvents();
    expect(events).toHaveLength(5000);
    expect(events[0]?.id).toBe("event-5");
    expect(getRuntimeEvent("event-0")).toBeNull();
  });
});
