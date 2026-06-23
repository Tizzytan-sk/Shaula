import { describe, expect, it } from "vitest";
import type { AgentRecord } from "@/lib/agent-registry";
import {
  buildLocalCodingAssistantSessionModel,
  handleModelToolPostAction,
  isModelToolPostAction,
} from "./model-tool-actions";

function fakeRecord() {
  const activeTools: string[][] = [];
  const rec = {
    id: "agent-1",
    cwd: "C:/repo",
    session: {
      thinkingLevel: "low",
      setThinkingLevel(level: string) {
        this.thinkingLevel = level;
      },
      setActiveToolsByName(names: string[]) {
        activeTools.push(names);
      },
      getActiveToolNames() {
        return activeTools.at(-1) ?? [];
      },
    },
  } as unknown as AgentRecord;
  return { rec, activeTools };
}

describe("model/tool action helpers", () => {
  it("classifies model and tool POST actions", () => {
    expect(isModelToolPostAction("set_model")).toBe(true);
    expect(isModelToolPostAction("setModel")).toBe(true);
    expect(isModelToolPostAction("set_thinking_level")).toBe(true);
    expect(isModelToolPostAction("set_tools")).toBe(true);
    expect(isModelToolPostAction("goal_update")).toBe(false);
    expect(isModelToolPostAction("prompt")).toBe(false);
  });

  it("builds the local coding assistant session model payload", () => {
    expect(
      buildLocalCodingAssistantSessionModel({
        id: "gpt-5.5-codex-max",
        name: "GPT-5.5 Codex Max",
      })
    ).toMatchObject({
      provider: "local-coding-assistant",
      id: "gpt-5.5-codex-max",
      api: "local-cli",
      reasoning: true,
      input: ["text"],
    });
  });

  it("updates thinking level through the session", async () => {
    const { rec } = fakeRecord();

    const result = await handleModelToolPostAction({
      type: "setThinkingLevel",
      agentId: rec.id,
      rec,
      body: { level: "high" },
    });

    expect(result).toEqual({ body: { ok: true, thinkingLevel: "high" } });
  });

  it("filters tool names to strings before updating the session", async () => {
    const { rec, activeTools } = fakeRecord();

    const result = await handleModelToolPostAction({
      type: "set_tools",
      agentId: rec.id,
      rec,
      body: { tools: ["shell", 42, "browser_open", null] },
    });

    expect(activeTools).toEqual([["shell", "browser_open"]]);
    expect(result).toEqual({
      body: { ok: true, active: ["shell", "browser_open"] },
    });
  });

  it("rejects malformed model and tool requests without touching the session", async () => {
    const { rec } = fakeRecord();

    await expect(
      handleModelToolPostAction({
        type: "set_model",
        agentId: rec.id,
        rec,
        body: { provider: "openai" },
      })
    ).resolves.toEqual({
      body: { error: "provider and modelId required" },
      status: 400,
    });

    await expect(
      handleModelToolPostAction({
        type: "set_tools",
        agentId: rec.id,
        rec,
        body: { tools: "shell" },
      })
    ).resolves.toEqual({
      body: { error: "tools (string[]) required" },
      status: 400,
    });
  });
});
