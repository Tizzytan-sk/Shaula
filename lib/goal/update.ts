import "server-only";
import { reconcileEvaluationActions } from "@/lib/evaluation-actions/store";
import { buildBlockedState } from "./blocked-state";
import {
  getGoal,
  patchGoal,
  setGoalStatus,
} from "./file-store";
import type { GoalUpdateInput, GoalUpdateResult } from "./types";
import { buildVerifierRejectionNote, verifyGoalCompletion } from "./verifier";
import { collectGoalVerificationInput } from "./verification-input";

/**
 * Apply a goal status update with stop-time verification.
 *
 * - `blocked` is applied directly (the model is allowed to declare a blocker).
 * - `complete` is routed through the verifier. If the verifier rejects it, the
 *   goal stays ACTIVE and a rejection note is returned so the caller can feed it
 *   back to the model instead of falsely closing the goal.
 *
 * Shared by the goal_update tool (agent-registry) and the goal_update API route
 * so both paths enforce identical completion gating.
 */
export function applyGoalUpdate(
  agentId: string,
  input: GoalUpdateInput
): GoalUpdateResult {
  const current = getGoal(agentId);
  if (!current) {
    return { goal: null, accepted: false };
  }

  if (input.status === "blocked") {
    // Build/advance the structured blocked state. Repeating the same blocker
    // increments repeatedCount (and blockedStreak) so the runtime can later stop
    // auto-retrying a goal stuck on the same wall.
    const blockedState = buildBlockedState(
      input.blockedReason,
      current.blockedState
    );
    setGoalStatus(agentId, "blocked", {
      blockedReason: input.blockedReason,
    });
    const goal = patchGoal(agentId, {
      blockedState,
      blockedStreak: blockedState.repeatedCount,
      lastEvaluation: undefined,
      lastClosure: undefined,
    });
    return { goal, accepted: true };
  }

  // status === "complete": verify before accepting.
  const collected = collectGoalVerificationInput(agentId, current);
  if (!collected) return { goal: current, accepted: false };
  const verification = verifyGoalCompletion(collected.input);

  if (verification.decision === "reject") {
    reconcileEvaluationActions({
      agentId,
      evaluation: verification.evaluation,
    });
    // Keep the goal active; do not mark complete.
    const goal = patchGoal(agentId, {
      lastEvaluation: verification.evaluation,
    });
    return {
      goal: goal ?? current,
      accepted: false,
      rejectionNote: buildVerifierRejectionNote(verification),
      evaluation: verification.evaluation,
    };
  }

  setGoalStatus(agentId, "complete");
  // Resolve any lingering blocked state so a future goal does not inherit a
  // stale blocker; reset the streak.
  const goal = patchGoal(agentId, {
    blockedStreak: 0,
    lastEvaluation: verification.evaluation,
    lastClosure: undefined,
    ...(current.blockedState && current.blockedState.resolvedAt === undefined
      ? {
          blockedState: {
            ...current.blockedState,
            resolvedAt: Date.now(),
          },
        }
      : {}),
  });
  reconcileEvaluationActions({
    agentId,
    evaluation: verification.evaluation,
  });
  return { goal, accepted: true, evaluation: verification.evaluation };
}
