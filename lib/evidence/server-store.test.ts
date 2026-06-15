import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetEvidenceStoreForTest,
  appendEvidence,
  getEvidence,
  listEvidence,
} from "./server-store";

describe("evidence server store", () => {
  beforeEach(() => {
    __resetEvidenceStoreForTest();
  });

  it("appends and lists evidence by ownership ids", () => {
    appendEvidence({
      id: "browser-1",
      kind: "browser_step",
      title: "Open fixture",
      sessionId: "session-1",
      agentId: "agent-1",
      browserId: "agent:agent-1",
      createdAt: 2,
    });
    appendEvidence({
      id: "workflow-1",
      kind: "workflow_artifact",
      title: "Workflow artifact",
      sessionId: "session-1",
      workflowId: "workflow-1",
      createdAt: 1,
    });

    expect(listEvidence({ sessionId: "session-1" }).map((e) => e.id)).toEqual([
      "workflow-1",
      "browser-1",
    ]);
    expect(listEvidence({ browserId: "agent:agent-1" })).toHaveLength(1);
    expect(listEvidence({ workflowId: "workflow-1" })).toHaveLength(1);
  });

  it("upserts by stable id instead of duplicating", () => {
    appendEvidence({
      id: "same",
      kind: "log",
      title: "First",
      createdAt: 1,
    });
    appendEvidence({
      id: "same",
      kind: "log",
      title: "Second",
      textPreview: "updated",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(listEvidence()).toHaveLength(1);
    expect(getEvidence("same")).toMatchObject({
      title: "Second",
      textPreview: "updated",
      updatedAt: 2,
    });
  });

  it("normalizes trust/source and filters by criteria mapping", () => {
    appendEvidence({
      id: "browser-1",
      kind: "browser_step",
      title: "Browser proof",
      agentId: "agent-1",
      browserId: "agent:agent-1",
      criteria: [{ contractCriterionId: "objective-met" }],
      createdAt: 1,
    });

    const stored = getEvidence("browser-1");
    expect(stored?.trustLevel).toBe("host_observed");
    expect(stored?.source).toMatchObject({
      type: "browser",
      id: "agent:agent-1",
    });
    expect(listEvidence({ trustLevel: "host_observed" })).toHaveLength(1);
    expect(listEvidence({ sourceType: "browser" })).toHaveLength(1);
    expect(
      listEvidence({ contractCriterionId: "objective-met" }).map(
        (item) => item.id
      )
    ).toEqual(["browser-1"]);
  });

  it("re-normalizes stored progress artifact trust at read time", () => {
    appendEvidence({
      id: "stale-progress",
      kind: "progress_artifact",
      title: "source_note: package.json",
      agentId: "agent-1",
      trustLevel: "artifact_reference",
      metadata: {
        kind: "file",
        href: "C:/repo/package.json",
      },
      createdAt: 1,
    });

    expect(getEvidence("stale-progress")).toMatchObject({
      trustLevel: "agent_reported",
      source: { type: "progress" },
    });
    expect(listEvidence({ trustLevel: "artifact_reference" })).toEqual([]);
  });

  it("keeps only the most recent evidence refs", () => {
    for (let i = 0; i < 5005; i += 1) {
      appendEvidence({
        id: `evidence-${i}`,
        kind: "log",
        title: `Evidence ${i}`,
        createdAt: i,
      });
    }

    const evidence = listEvidence();
    expect(evidence).toHaveLength(5000);
    expect(evidence[0]?.id).toBe("evidence-5");
    expect(getEvidence("evidence-0")).toBeNull();
  });
});
