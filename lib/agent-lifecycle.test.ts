import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentGoal } from "./goal/types";
import {
  buildGoalContinuationPrompt,
  clearFinishWatchdog,
  handleAgentSessionLifecycleEvent,
  maybeContinueGoal,
  messageHasStopReason,
  pauseGoalForUserInput,
  type AgentLifecycleDeps,
  type AgentLifecycleRecord,
} from "./agent-lifecycle";

function goal(patch: Partial<AgentGoal> = {}): AgentGoal {
  return {
    objective: "Ship the feature",
    status: "active",
    turns: 0,
    blockedStreak: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function record(): AgentLifecycleRecord {
  return {
    id: "agent-1",
    isStreaming: false,
    isPromptStarting: true,
    updatedAt: 0,
    finishWatchdog: null,
    pendingFinishMessage: null,
    session: {
      sessionId: "session-1",
      prompt: vi.fn(async () => undefined),
    },
  };
}

function deps(currentGoal: AgentGoal | null): AgentLifecycleDeps {
  let storedGoal = currentGoal;
  return {
    now: () => 1000,
    getGoal: vi.fn(() => storedGoal),
    setGoalStatus: vi.fn((_agentId, status, details) => {
      if (!storedGoal) return null;
      storedGoal = {
        ...storedGoal,
        status,
        blockedReason: details?.blockedReason,
        pauseReason: details?.pauseReason,
      };
      return storedGoal;
    }),
    pushGoal: vi.fn(),
    listPendingApprovals: vi.fn(() => []),
    listPendingClarifications: vi.fn(() => []),
    noteGoalContinuation: vi.fn(() => {
      if (!storedGoal) return null;
      storedGoal = {
        ...storedGoal,
        turns: storedGoal.turns + 1,
        lastRunAt: 1000,
      };
      return storedGoal;
    }),
    patchGoal: vi.fn((_agentId, patch) => {
      if (!storedGoal) return null;
      storedGoal = { ...storedGoal, ...patch };
      return storedGoal;
    }),
    buildGoalRecap: vi.fn(() => "recent context"),
    startGoalTurn: vi.fn(() => ({
      turnNumber: 1,
      startedAt: 1000,
      status: "running" as const,
    })),
    finishGoalTurn: vi.fn(() => ({
      turnNumber: 1,
      startedAt: 1,
      endedAt: 1000,
      status: "completed" as const,
    })),
    evaluateAndStoreGoalRunClosure: vi.fn(() =>
      storedGoal ? { goal: storedGoal } : null
    ),
  };
}

describe("agent lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds continuation prompts with closure and recap context", () => {
    const prompt = buildGoalContinuationPrompt(
      goal({
        lastClosure: {
          id: "closure-1",
          verdict: "ready_to_finalize",
          reason: "all criteria met",
          missingEvidence: [],
          openActions: [],
          nextAction: "finalize",
          createdAt: 1,
        },
      }),
      "tests passed"
    );

    expect(prompt).toContain("Ship the feature");
    expect(prompt).toContain("tests passed");
    expect(prompt).toContain("Finalize now");
  });

  it("detects terminal assistant stop reasons only from assistant messages", () => {
    expect(
      messageHasStopReason({
        message: { role: "assistant", stopReason: "stop" },
      })
    ).toBe(true);
    expect(
      messageHasStopReason({
        assistantMessageEvent: {
          partial: { role: "assistant", stopReason: "tool_calls" },
        },
      })
    ).toBe(true);
    expect(
      messageHasStopReason({
        message: { role: "user", stopReason: "stop" },
      })
    ).toBe(false);
  });

  it("starts a goal turn on agent_start for active goals", () => {
    const rec = record();
    const d = deps(goal());

    handleAgentSessionLifecycleEvent(rec, { type: "agent_start" }, d);

    expect(rec.isStreaming).toBe(true);
    expect(rec.isPromptStarting).toBe(false);
    expect(rec.updatedAt).toBe(1000);
    expect(d.startGoalTurn).toHaveBeenCalledWith("agent-1");
  });

  it("schedules finish handling on final assistant message_end", async () => {
    const rec = record();
    rec.isStreaming = true;
    const d = deps(goal({ status: "complete" }));

    handleAgentSessionLifecycleEvent(
      rec,
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "stop" },
      },
      d
    );

    expect(rec.pendingFinishMessage).toEqual({
      role: "assistant",
      stopReason: "stop",
    });
    expect(rec.isStreaming).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);

    expect(rec.isStreaming).toBe(false);
    expect(rec.pendingFinishMessage).toBeNull();
    expect(d.finishGoalTurn).toHaveBeenCalledWith("agent-1", {
      status: "completed",
    });
    expect(d.evaluateAndStoreGoalRunClosure).toHaveBeenCalledWith("agent-1", {
      sessionId: "session-1",
    });
  });

  it("clears watchdog and finishes immediately on agent_end", () => {
    const rec = record();
    rec.isStreaming = true;
    rec.finishWatchdog = setTimeout(() => undefined, 5000);
    rec.pendingFinishMessage = { role: "assistant", stopReason: "stop" };
    const d = deps(goal({ status: "complete" }));

    handleAgentSessionLifecycleEvent(rec, { type: "agent_end" }, d);

    expect(rec.isStreaming).toBe(false);
    expect(rec.isPromptStarting).toBe(false);
    expect(rec.finishWatchdog).toBeNull();
    expect(rec.pendingFinishMessage).toBeNull();
    expect(d.finishGoalTurn).toHaveBeenCalled();
  });

  it("pauses active goals for user input", () => {
    const rec = record();
    const d = deps(goal());

    pauseGoalForUserInput(rec, "Waiting for user input: choose path", d);

    expect(d.setGoalStatus).toHaveBeenCalledWith("agent-1", "paused", {
      pauseReason: "Waiting for user input: choose path",
    });
    expect(d.pushGoal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paused" })
    );
  });

  it("continues active goals by recording a continuation and prompting later", async () => {
    const rec = record();
    const d = deps(goal({ lastRunAt: 0 }));

    maybeContinueGoal(rec, d);

    expect(d.noteGoalContinuation).toHaveBeenCalledWith("agent-1");
    expect(d.pushGoal).toHaveBeenCalledWith(
      expect.objectContaining({ turns: 1 })
    );

    await vi.advanceTimersByTimeAsync(200);

    expect(rec.session.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Continue working toward the active goal")
    );
  });

  it("clears finish watchdog state", () => {
    const rec = record();
    rec.finishWatchdog = setTimeout(() => undefined, 5000);
    rec.pendingFinishMessage = { role: "assistant" };

    clearFinishWatchdog(rec);

    expect(rec.finishWatchdog).toBeNull();
    expect(rec.pendingFinishMessage).toBeNull();
  });
});
