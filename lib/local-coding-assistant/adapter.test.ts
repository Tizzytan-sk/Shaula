import { describe, expect, it } from "vitest";
import {
  LOCAL_CODING_ASSISTANT_CLI,
  LOCAL_CODING_ASSISTANT_MODEL_ID,
  buildLocalCodingAssistantCliArgs,
  buildLocalCodingAssistantPrompt,
  buildLocalCodingAssistantSessionModel,
  createLocalCodingAssistantSession,
  extractLocalCodingAssistantText,
  isLocalCodingAssistantModelId,
  localCodingAssistantMessage,
  localCodingAssistantModelPayload,
} from "./adapter";

describe("local-coding-assistant adapter", () => {
  it("keeps local model identity and session payload centralized", () => {
    expect(LOCAL_CODING_ASSISTANT_CLI).toBe("codewiz-cc");
    expect(isLocalCodingAssistantModelId(LOCAL_CODING_ASSISTANT_MODEL_ID)).toBe(
      true
    );
    expect(isLocalCodingAssistantModelId("missing-model")).toBe(false);

    expect(
      localCodingAssistantModelPayload({
        id: "sonnet",
        name: "Claude Sonnet (自研助手)",
      })
    ).toEqual({
      provider: "local-coding-assistant",
      id: "sonnet",
      name: "Claude Sonnet (自研助手)",
    });

    expect(
      buildLocalCodingAssistantSessionModel({
        id: "sonnet",
        name: "Claude Sonnet (自研助手)",
      })
    ).toMatchObject({
      provider: "local-coding-assistant",
      id: "sonnet",
      api: "local-cli",
      baseUrl: "local-cli",
      reasoning: true,
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 64000,
    });
  });

  it("builds CLI args with the Shaula system prompt and optional model arg", () => {
    const defaultArgs = buildLocalCodingAssistantCliArgs(
      "修复测试",
      LOCAL_CODING_ASSISTANT_MODEL_ID
    );
    expect(defaultArgs).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "default",
      buildLocalCodingAssistantPrompt("修复测试"),
    ]);

    const sonnetArgs = buildLocalCodingAssistantCliArgs("修复测试", "sonnet");
    expect(sonnetArgs).toContain("--model");
    expect(sonnetArgs).toContain("sonnet");
    expect(sonnetArgs.at(-1)).toContain("User task:\n修复测试");
    expect(sonnetArgs.at(-1)).toContain("Shaula operating rules:");
  });

  it("creates a text-only AgentSession shim", async () => {
    const session = createLocalCodingAssistantSession("session-1", "sonnet");

    expect(session.sessionId).toBe("session-1");
    expect(session.sessionFile).toBeUndefined();
    expect(session.model).toMatchObject({
      provider: "local-coding-assistant",
      id: "sonnet",
    });
    expect(session.supportsThinking()).toBe(false);
    expect(session.getAllTools()).toEqual([]);
    expect(await session.prompt("ignored")).toBeUndefined();
  });

  it("normalizes local assistant messages and streamed JSON lines", () => {
    expect(
      localCodingAssistantMessage("assistant", "hello", "response-1", "sonnet")
    ).toMatchObject({
      role: "assistant",
      responseId: "response-1",
      provider: "local-coding-assistant",
      model: "sonnet",
      api: "local-cli",
      content: [{ type: "text", text: "hello" }],
    });

    expect(extractLocalCodingAssistantText({ delta: "a" })).toBe("a");
    expect(extractLocalCodingAssistantText({ text: "b" })).toBe("b");
    expect(
      extractLocalCodingAssistantText({
        message: { content: [{ type: "text", text: "c" }] },
      })
    ).toBe("c");
    expect(extractLocalCodingAssistantText({ type: "result", result: "done" }))
      .toBe("done");
    expect(extractLocalCodingAssistantText({ type: "tool_call" })).toBe("");
  });
});
