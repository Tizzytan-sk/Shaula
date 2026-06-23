import "server-only";
import { buildGoalClosurePromptFragment } from "./goal/closure";
import type { AgentGoal, GoalTurn } from "./goal/types";
import { shouldStopRetrying } from "./goal/blocked-state";

export const FINISH_WATCHDOG_MS = 1500;
export const GOAL_CONTINUATION_DELAY_MS = 200;

export interface AgentLifecycleRecord {
  id: string;
  isStreaming: boolean;
  isPromptStarting: boolean;
  updatedAt: number;
  finishWatchdog: ReturnType<typeof setTimeout> | null;
  pendingFinishMessage: unknown | null;
  session: {
    sessionId: string;
    prompt: (text: string) => Promise<unknown>;
  };
}

export interface AgentLifecycleDeps {
  now?: () => number;
  setTimeout?: (
    cb: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  continuationDelayMs?: number;
  getGoal: (agentId: string) => AgentGoal | null;
  setGoalStatus: (
    agentId: string,
    status: "paused" | "blocked" | "complete" | "active",
    details?: { blockedReason?: string; pauseReason?: string }
  ) => AgentGoal | null;
  pushGoal: (goal: AgentGoal | null) => void;
  listPendingApprovals: (agentId: string) => unknown[];
  listPendingClarifications: (agentId: string) => unknown[];
  noteGoalContinuation: (agentId: string) => AgentGoal | null;
  patchGoal: (
    agentId: string,
    patch: Partial<Omit<AgentGoal, "createdAt" | "objective">> & {
      objective?: string;
    }
  ) => AgentGoal | null;
  buildGoalRecap: (agentId: string) => string;
  startGoalTurn: (agentId: string) => GoalTurn | null;
  finishGoalTurn: (
    agentId: string,
    patch?: {
      turnNumber?: number;
      status?: GoalTurn["status"];
      summary?: string;
      tokenUsed?: number;
      blockedReason?: string;
      evidenceIds?: string[];
    }
  ) => GoalTurn | null;
  evaluateAndStoreGoalRunClosure: (
    agentId: string,
    options?: { sessionId?: string | null }
  ) => { goal: AgentGoal } | null;
}

export function buildGoalContinuationPrompt(
  goal: AgentGoal,
  recap?: string
): string {
  const closureLines = buildGoalClosurePromptFragment(goal.lastClosure);
  return [
    "Continue working toward the active goal:",
    "",
    goal.objective,
    ...(closureLines.length > 0 ? ["", ...closureLines] : []),
    ...(recap && recap.trim()
      ? ["", "Context from previous turns (do not repeat finished work):", recap]
      : []),
    "",
    goal.lastClosure?.verdict === "ready_to_finalize"
      ? "Finalize now: summarize the completed work, cite the evidence, and call goal_update with status=complete."
      : "Do the next useful step from the harness closure. If the full goal is achieved, call goal_update with status=complete.",
    "Keep the user-visible progress current with update_progress when steps start, finish, block, or produce evidence artifacts.",
    "If you are truly blocked and cannot make meaningful progress without user input or an external change, call goal_update with status=blocked and include a short blockedReason.",
    "Otherwise continue implementation, verification, or investigation. Keep the user informed with concise progress.",
  ].join("\n");
}

export function messageHasStopReason(
  event: unknown
): event is { message: unknown } {
  if (!event || typeof event !== "object") return false;
  const e = event as {
    message?: { role?: string; stopReason?: unknown };
    assistantMessageEvent?: {
      partial?: { role?: string; stopReason?: unknown };
    };
  };
  const msg = e.message ?? e.assistantMessageEvent?.partial;
  return msg?.role === "assistant" && typeof msg.stopReason === "string";
}

export function clearFinishWatchdog(rec: AgentLifecycleRecord): void {
  if (rec.finishWatchdog) {
    clearTimeout(rec.finishWatchdog);
    rec.finishWatchdog = null;
  }
  rec.pendingFinishMessage = null;
}

export function pauseGoalForUserInput(
  rec: AgentLifecycleRecord,
  reason: string,
  deps: AgentLifecycleDeps
): void {
  const goal = deps.getGoal(rec.id);
  if (!goal || goal.status !== "active") return;
  const paused = deps.setGoalStatus(rec.id, "paused", {
    pauseReason: reason,
  });
  deps.pushGoal(paused);
}

export function maybeContinueGoal(
  rec: AgentLifecycleRecord,
  deps: AgentLifecycleDeps
): void {
  const goal = deps.getGoal(rec.id);
  if (!goal || goal.status !== "active") return;

  const closure = goal.lastClosure;
  if (closure?.verdict === "needs_user") {
    const paused = deps.setGoalStatus(rec.id, "paused", {
      pauseReason: `Harness needs user input: ${
        closure.userQuestion ?? closure.reason
      }`,
    });
    deps.pushGoal(paused);
    return;
  }
  if (closure?.verdict === "blocked") {
    const paused = deps.setGoalStatus(rec.id, "paused", {
      pauseReason: `Harness blocked: ${closure.nextAction || closure.reason}`,
    });
    deps.pushGoal(paused);
    return;
  }
  if (
    closure?.verdict === "ready_to_finalize" &&
    closure.finalizationPromptedAt
  ) {
    const paused = deps.setGoalStatus(rec.id, "paused", {
      pauseReason:
        "Harness already requested finalization; waiting for explicit goal completion.",
    });
    deps.pushGoal(paused);
    return;
  }

  if (shouldStopRetrying(goal.blockedState)) {
    const state = goal.blockedState!;
    const paused = deps.setGoalStatus(rec.id, "paused", {
      pauseReason: `Stuck on a repeated blocker (${state.repeatedCount}x): ${state.unblockAction}`,
    });
    deps.pushGoal(paused);
    return;
  }

  if (
    deps.listPendingApprovals(rec.id).length > 0 ||
    deps.listPendingClarifications(rec.id).length > 0
  ) {
    const paused = deps.setGoalStatus(rec.id, "paused", {
      pauseReason: "Waiting for user input.",
    });
    deps.pushGoal(paused);
    return;
  }

  const now = deps.now?.() ?? Date.now();
  if (goal.lastRunAt && now - goal.lastRunAt < 1200) return;
  let next = deps.noteGoalContinuation(rec.id);
  if (!next || next.status !== "active") return;
  if (
    next.lastClosure?.verdict === "ready_to_finalize" &&
    !next.lastClosure.finalizationPromptedAt
  ) {
    next =
      deps.patchGoal(rec.id, {
        lastClosure: {
          ...next.lastClosure,
          finalizationPromptedAt: now,
        },
      }) ?? next;
  }
  deps.pushGoal(next);

  const setTimeoutFn = deps.setTimeout ?? setTimeout;
  setTimeoutFn(() => {
    const latest = deps.getGoal(rec.id);
    if (!latest || latest.status !== "active" || rec.isStreaming) return;
    const recap = deps.buildGoalRecap(rec.id);
    void rec.session.prompt(buildGoalContinuationPrompt(latest, recap)).catch((e) => {
      const paused = deps.setGoalStatus(rec.id, "paused", {
        pauseReason:
          e instanceof Error ? e.message : "Goal continuation failed.",
      });
      deps.pushGoal(paused);
    });
  }, deps.continuationDelayMs ?? GOAL_CONTINUATION_DELAY_MS);
}

export function finishStreamingRun(
  rec: AgentLifecycleRecord,
  deps: AgentLifecycleDeps
): void {
  if (!rec.isStreaming) return;
  rec.isStreaming = false;
  const goal = deps.getGoal(rec.id);
  if (goal) {
    const turnStatus =
      goal.status === "complete"
        ? "completed"
        : goal.status === "blocked"
          ? "blocked"
          : "completed";
    deps.finishGoalTurn(rec.id, {
      status: turnStatus,
      ...(goal.status === "blocked" && goal.blockedReason
        ? { blockedReason: goal.blockedReason }
        : {}),
    });
    const storedClosure = deps.evaluateAndStoreGoalRunClosure(rec.id, {
      sessionId: rec.session.sessionId,
    });
    if (storedClosure) {
      deps.pushGoal(storedClosure.goal);
    }
  }
  maybeContinueGoal(rec, deps);
}

export function scheduleFinishWatchdog(
  rec: AgentLifecycleRecord,
  message: unknown,
  deps: AgentLifecycleDeps
): void {
  clearFinishWatchdog(rec);
  rec.pendingFinishMessage = message;
  const setTimeoutFn = deps.setTimeout ?? setTimeout;
  rec.finishWatchdog = setTimeoutFn(() => {
    rec.finishWatchdog = null;
    rec.pendingFinishMessage = null;
    finishStreamingRun(rec, deps);
  }, FINISH_WATCHDOG_MS);
}

export function handleAgentSessionLifecycleEvent(
  rec: AgentLifecycleRecord,
  event: unknown,
  deps: AgentLifecycleDeps
): void {
  const typed = event as { type?: string; message?: unknown };
  if (typed.type === "agent_start") {
    clearFinishWatchdog(rec);
    rec.isStreaming = true;
    rec.isPromptStarting = false;
    rec.updatedAt = deps.now?.() ?? Date.now();
    const goal = deps.getGoal(rec.id);
    if (goal && goal.status === "active") {
      deps.startGoalTurn(rec.id);
    }
  } else if (typed.type === "tool_execution_start") {
    clearFinishWatchdog(rec);
  } else if (typed.type === "message_end" && messageHasStopReason(event)) {
    scheduleFinishWatchdog(rec, typed.message, deps);
  } else if (typed.type === "agent_end") {
    rec.isPromptStarting = false;
    clearFinishWatchdog(rec);
    finishStreamingRun(rec, deps);
    rec.updatedAt = deps.now?.() ?? Date.now();
  } else if (messageHasStopReason(event)) {
    // Stop-reason-bearing partial assistant messages are not terminal events.
  }
}
