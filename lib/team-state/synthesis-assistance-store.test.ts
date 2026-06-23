import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTeamSynthesisAssistanceStoreForTest,
  __setTeamSynthesisAssistanceStoreRootForTest,
  getTeamSynthesisAssistance,
  putTeamSynthesisAssistance,
} from "./synthesis-assistance-store";

describe("team synthesis assistance store", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shaula-team-assist-test-"));
    __setTeamSynthesisAssistanceStoreRootForTest(tmpDir);
  });

  afterEach(() => {
    __resetTeamSynthesisAssistanceStoreForTest();
    __setTeamSynthesisAssistanceStoreRootForTest(null);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists and hydrates assistance by agent and synthesis fingerprint", () => {
    putTeamSynthesisAssistance({
      agentId: "agent-1",
      fingerprint: "abc123",
      assistance: {
        status: "accepted",
        source: "llm_assisted",
        generatedAt: 10,
        headline: "Useful Team synthesis.",
        summary: "The LLM summary only cites known items.",
        itemIds: ["task:1"],
        taskIds: ["task-1"],
        evidenceIds: ["evidence-1"],
        warnings: [],
      },
      model: { provider: "openai", id: "gpt-test", name: "GPT Test" },
      latencyMs: 123,
      httpStatus: 200,
      tokenCount: 42,
      estimatedCost: 0.0012,
      createdAt: 10,
      updatedAt: 10,
    });

    expect(getTeamSynthesisAssistance("agent-1", "abc123")).toMatchObject({
      assistance: { status: "accepted", evidenceIds: ["evidence-1"] },
      model: { provider: "openai", id: "gpt-test" },
      latencyMs: 123,
      httpStatus: 200,
      tokenCount: 42,
      estimatedCost: 0.0012,
    });

    __setTeamSynthesisAssistanceStoreRootForTest(tmpDir);

    expect(getTeamSynthesisAssistance("agent-1", "abc123")).toMatchObject({
      assistance: { headline: "Useful Team synthesis." },
      tokenCount: 42,
    });
    expect(getTeamSynthesisAssistance("agent-1", "other")).toBeNull();
  });
});
