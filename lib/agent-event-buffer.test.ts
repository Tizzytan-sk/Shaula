import { describe, expect, it } from "vitest";
import {
  appendAgentEventBufferEntry,
  createAgentEventBuffer,
  getAgentEventsSince,
  getLatestAgentEventSeq,
  notifyAgentEventListeners,
  subscribeAgentEvent,
} from "./agent-event-buffer";

describe("agent event ring buffer", () => {
  it("appends events with monotonic sequence numbers", () => {
    const buffer = createAgentEventBuffer<string>(3);

    expect(appendAgentEventBufferEntry(buffer, "a")).toBe(0);
    expect(appendAgentEventBufferEntry(buffer, "b")).toBe(1);

    expect(getLatestAgentEventSeq(buffer)).toBe(1);
    expect(getAgentEventsSince(buffer, -1)).toEqual([
      { seq: 0, event: "a" },
      { seq: 1, event: "b" },
    ]);
  });

  it("replays only retained events after wraparound in sequence order", () => {
    const buffer = createAgentEventBuffer<string>(3);

    appendAgentEventBufferEntry(buffer, "a");
    appendAgentEventBufferEntry(buffer, "b");
    appendAgentEventBufferEntry(buffer, "c");
    appendAgentEventBufferEntry(buffer, "d");
    appendAgentEventBufferEntry(buffer, "e");

    expect(getAgentEventsSince(buffer, -1)).toEqual([
      { seq: 2, event: "c" },
      { seq: 3, event: "d" },
      { seq: 4, event: "e" },
    ]);
    expect(getAgentEventsSince(buffer, 2)).toEqual([
      { seq: 3, event: "d" },
      { seq: 4, event: "e" },
    ]);
  });

  it("notifies active listeners and stops notifying after unsubscribe", () => {
    const buffer = createAgentEventBuffer<string>(2);
    let count = 0;
    const unsubscribe = subscribeAgentEvent(buffer, () => {
      count += 1;
    });

    notifyAgentEventListeners(buffer);
    unsubscribe();
    notifyAgentEventListeners(buffer);

    expect(count).toBe(1);
  });

  it("initializes empty event arrays used by lightweight test records", () => {
    const buffer = {
      events: [],
      nextSeq: 0,
      listeners: new Set<() => void>(),
    };

    appendAgentEventBufferEntry(buffer, "a");

    expect(buffer.events[0]).toEqual({ seq: 0, event: "a" });
    expect(buffer.events.length).toBeGreaterThan(1);
  });
});
