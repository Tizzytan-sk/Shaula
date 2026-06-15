import type { EvaluationAction } from "@/lib/evaluation-actions/types";
import type { AgentGoal, GoalRunClosure } from "./types";
import type { GoalVerifyResult } from "./verifier";

export interface GoalRunClosureInput {
  agentId: string;
  goal: AgentGoal;
  verification: GoalVerifyResult;
  openActions: EvaluationAction[];
  createdAt?: number;
}

export function evaluateGoalRunClosure(
  input: GoalRunClosureInput
): GoalRunClosure {
  const createdAt = input.createdAt ?? Date.now();
  const askUserAction = input.openActions.find(
    (action) => action.kind === "ask_user"
  );
  const blockedAction = input.openActions.find(
    (action) => action.kind === "blocked"
  );
  const firstAction = input.openActions[0];
  const missingEvidence = input.verification.missingEvidence;

  if (input.goal.status === "blocked" || blockedAction) {
    return {
      id: closureId(input.agentId, createdAt),
      verdict: "blocked",
      reason:
        input.goal.blockedReason ??
        blockedAction?.detail ??
        "The run is blocked and should not auto-continue without a concrete unblock path.",
      missingEvidence,
      openActions: summarizeActions(input.openActions),
      nextAction:
        input.goal.blockedState?.unblockAction ??
        blockedAction?.nextAction ??
        "Surface the blocker and wait for an unblock path.",
      createdAt,
      ...evaluationSummary(input.verification),
    };
  }

  if (askUserAction) {
    return {
      id: closureId(input.agentId, createdAt),
      verdict: "needs_user",
      reason: askUserAction.detail || "The evaluator requires a user decision.",
      missingEvidence,
      openActions: summarizeActions(input.openActions),
      nextAction: askUserAction.nextAction,
      userQuestion: askUserAction.title,
      createdAt,
      ...evaluationSummary(input.verification),
    };
  }

  if (
    input.verification.decision === "reject" ||
    input.verification.evaluation.status !== "passed" ||
    input.openActions.length > 0
  ) {
    return {
      id: closureId(input.agentId, createdAt),
      verdict: "continue",
      reason:
        input.verification.reason ||
        "The run has unresolved evaluator actions or failed evaluation criteria.",
      missingEvidence,
      openActions: summarizeActions(input.openActions),
      nextAction:
        firstAction?.nextAction ??
        missingEvidence[0] ??
        input.verification.evaluation.nextAction ??
        "Continue implementation or verification and record concrete evidence.",
      createdAt,
      ...evaluationSummary(input.verification),
    };
  }

  return {
    id: closureId(input.agentId, createdAt),
    verdict: "ready_to_finalize",
    reason: input.verification.reason,
    missingEvidence: [],
    openActions: [],
    nextAction:
      "Summarize the completed work, cite the evidence, and call goal_update with status=complete.",
    createdAt,
    ...evaluationSummary(input.verification),
  };
}

export function buildGoalClosurePromptFragment(
  closure: GoalRunClosure | undefined
): string[] {
  if (!closure) return [];
  const lines = [
    "Latest harness closure:",
    `- Verdict: ${closure.verdict}`,
    `- Reason: ${closure.reason}`,
    `- Next action: ${closure.nextAction}`,
  ];
  if (closure.missingEvidence.length > 0) {
    lines.push("- Missing evidence:");
    for (const item of closure.missingEvidence.slice(0, 6)) {
      lines.push(`  - ${item}`);
    }
  }
  if (closure.openActions.length > 0) {
    lines.push("- Open evaluator actions:");
    for (const action of closure.openActions.slice(0, 6)) {
      lines.push(`  - [${action.kind}] ${action.title}: ${action.nextAction}`);
    }
  }
  if (closure.userQuestion) {
    lines.push(`- User decision needed: ${closure.userQuestion}`);
  }
  if (closure.verdict === "ready_to_finalize") {
    lines.push(
      "The harness believes the work is ready to finalize. Do not start unrelated new work; produce the final summary and explicitly call goal_update with status=complete."
    );
  }
  return lines;
}

function summarizeActions(actions: EvaluationAction[]): GoalRunClosure["openActions"] {
  return actions.slice(0, 12).map((action) => ({
    id: action.id,
    kind: action.kind,
    title: action.title,
    nextAction: action.nextAction,
  }));
}

function evaluationSummary(result: GoalVerifyResult) {
  return {
    evaluationStatus: result.evaluation.status,
    evaluationScore: result.evaluation.totalScore,
    evaluationTargetScore: result.evaluation.targetScore,
  };
}

function closureId(agentId: string, createdAt: number): string {
  return `closure:${agentId}:${createdAt}`;
}
