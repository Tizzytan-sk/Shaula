import "server-only";
import {
  listEvaluationActions,
  reconcileEvaluationActions,
} from "@/lib/evaluation-actions/store";
import { patchGoal } from "./file-store";
import { evaluateGoalRunClosure } from "./closure";
import type { AgentGoal, GoalRunClosure } from "./types";
import { verifyGoalCompletion } from "./verifier";
import { collectGoalVerificationInput } from "./verification-input";

export interface StoredGoalRunClosure {
  goal: AgentGoal;
  closure: GoalRunClosure;
}

export function evaluateAndStoreGoalRunClosure(
  agentId: string
): StoredGoalRunClosure | null {
  const collected = collectGoalVerificationInput(agentId);
  if (!collected || collected.goal.status !== "active") return null;

  const verification = verifyGoalCompletion(collected.input);
  reconcileEvaluationActions({
    agentId,
    evaluation: verification.evaluation,
  });
  const openActions = listEvaluationActions({
    agentId,
    status: "open",
  });
  const closure = evaluateGoalRunClosure({
    agentId,
    goal: collected.goal,
    verification,
    openActions,
  });
  if (
    closure.verdict === "ready_to_finalize" &&
    collected.goal.lastClosure?.verdict === "ready_to_finalize" &&
    collected.goal.lastClosure.finalizationPromptedAt
  ) {
    closure.finalizationPromptedAt =
      collected.goal.lastClosure.finalizationPromptedAt;
  }
  const goal =
    patchGoal(agentId, {
      lastEvaluation: verification.evaluation,
      lastClosure: closure,
    }) ?? collected.goal;
  return { goal, closure };
}
