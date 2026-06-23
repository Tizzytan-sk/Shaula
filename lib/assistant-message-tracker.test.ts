import { describe, expect, it } from "vitest";
import {
  createAssistantMessageTracker,
  textFromAssistantContent,
  trackAssistantMessageEvent,
} from "./assistant-message-tracker";

describe("assistant message tracker", () => {
  it("extracts only text content parts", () => {
    expect(
      textFromAssistantContent([
        { type: "text", text: "hello" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: " world" },
      ])
    ).toBe("hello world");
  });

  it("deduplicates replayed start content while applying later deltas", () => {
    const tracker = createAssistantMessageTracker();
    trackAssistantMessageEvent(
      tracker,
      {
        type: "message_start",
        message: {
          role: "assistant",
          responseId: "resp-1",
          timestamp: 10,
          content: [{ type: "text", text: "Hello" }],
        },
      },
      () => 1
    );
    trackAssistantMessageEvent(tracker, {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello",
      },
    });
    trackAssistantMessageEvent(tracker, {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: " world",
      },
    });

    const actual = trackAssistantMessageEvent(
      tracker,
      {
        type: "message_end",
        message: {
          role: "assistant",
          responseId: "resp-1",
          stopReason: "stop",
          timestamp: 20,
        },
      },
      () => 2
    );

    expect(actual).toEqual({
      text: "Hello world",
      responseId: "resp-1",
      stopReason: "stop",
      endedAt: 20,
    });
    expect(tracker.active).toBeUndefined();
    expect(tracker.last).toEqual(actual);
  });

  it("starts from a text delta when no assistant start event was recorded", () => {
    const tracker = createAssistantMessageTracker();
    trackAssistantMessageEvent(
      tracker,
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "streamed text",
          partial: { responseId: "resp-2" },
        },
      },
      () => 30
    );

    const actual = trackAssistantMessageEvent(
      tracker,
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          timestamp: 40,
        },
      },
      () => 50
    );

    expect(actual).toMatchObject({
      text: "streamed text",
      responseId: "resp-2",
      stopReason: "stop",
      endedAt: 40,
    });
  });
});
