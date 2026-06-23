import type { GoalActualFinalMessage } from "./goal/types";

interface AssistantEventMessage {
  role?: string;
  responseId?: string;
  timestamp?: number;
  stopReason?: string;
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
  }>;
}

interface AssistantMessageEventLike {
  type?: string;
  delta?: string;
  partial?: {
    responseId?: string;
    content?: AssistantEventMessage["content"];
  };
}

export interface AssistantMessageStreamEvent {
  type?: string;
  message?: AssistantEventMessage;
  assistantMessageEvent?: AssistantMessageEventLike;
}

interface ActiveAssistantMessage {
  responseId?: string;
  text: string;
  replayText?: string;
  replayOffset?: number;
  startedAt: number;
}

export interface AssistantMessageTracker {
  active?: ActiveAssistantMessage;
  last?: GoalActualFinalMessage;
}

export function createAssistantMessageTracker(): AssistantMessageTracker {
  return {};
}

export function textFromAssistantContent(
  content: AssistantEventMessage["content"]
): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function trackAssistantMessageEvent(
  tracker: AssistantMessageTracker,
  event: AssistantMessageStreamEvent,
  now = Date.now
): GoalActualFinalMessage | null {
  if (event.type === "message_start" && event.message?.role === "assistant") {
    const text = textFromAssistantContent(event.message.content);
    tracker.active = {
      responseId: event.message.responseId,
      text,
      replayText: text || undefined,
      replayOffset: text ? 0 : undefined,
      startedAt: event.message.timestamp ?? now(),
    };
    return null;
  }

  if (event.type === "message_update") {
    const sub = event.assistantMessageEvent;
    if (sub?.type !== "text_delta" || !sub.delta) return null;
    if (!tracker.active) {
      tracker.active = {
        responseId: sub.partial?.responseId ?? event.message?.responseId,
        text: "",
        startedAt: now(),
      };
    }
    appendTextDelta(tracker.active, sub.delta);
    return null;
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    const fallbackText = textFromAssistantContent(event.message.content);
    const active = tracker.active;
    const text = (active?.text || fallbackText).trim();
    const actual: GoalActualFinalMessage = {
      text,
      responseId: event.message.responseId ?? active?.responseId,
      stopReason: event.message.stopReason,
      endedAt: event.message.timestamp ?? now(),
    };
    tracker.last = actual;
    tracker.active = undefined;
    return actual;
  }

  return null;
}

function appendTextDelta(active: ActiveAssistantMessage, delta: string): void {
  if (active.replayText) {
    const offset = active.replayOffset ?? 0;
    const replayText = active.replayText;
    const replayChunk = replayText.slice(offset, offset + delta.length);
    if (replayChunk === delta) {
      active.replayOffset = offset + delta.length;
      if (active.replayOffset >= replayText.length) {
        active.replayText = undefined;
        active.replayOffset = undefined;
      }
      return;
    }
    const remainingReplay = replayText.slice(offset);
    if (remainingReplay && delta.startsWith(remainingReplay)) {
      active.replayText = undefined;
      active.replayOffset = undefined;
      const suffix = delta.slice(remainingReplay.length);
      if (suffix) active.text += suffix;
      return;
    }
    active.replayText = undefined;
    active.replayOffset = undefined;
  }
  active.text += delta;
}
