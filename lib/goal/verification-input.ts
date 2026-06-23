import "server-only";
import type { EvaluationEvidence } from "@/lib/evaluation/types";
import { listEvidence } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import {
  evidenceRefToEvaluationEvidence,
  evidenceRefToGoalEvidence,
  goalEvidenceToEvaluationEvidence,
} from "@/lib/evidence/ledger";
import { getExecutionContract } from "@/lib/execution-contract/store";
import { toEvaluatorContractSource } from "@/lib/execution-contract/types";
import { listWorkflowRuns } from "@/lib/workflows/server-store";
import {
  getGoal,
  listGoalEvidence,
  listGoalTurns,
} from "./file-store";
import type { AgentGoal, GoalEvidence } from "./types";
import type { GoalVerifyInput } from "./verifier";

export interface CollectedGoalVerificationInput {
  input: GoalVerifyInput;
  goal: AgentGoal;
  goalEvidence: GoalEvidence[];
  evaluationEvidence: EvaluationEvidence[];
}

export function collectGoalVerificationInput(
  agentId: string,
  currentGoal = getGoal(agentId),
  options: { sessionId?: string | null } = {}
): CollectedGoalVerificationInput | null {
  if (!currentGoal) return null;
  const workflowRuns = listWorkflowRuns(agentId)
    .filter((run) => run.createdAt >= currentGoal.createdAt)
    .map((run) => ({
      id: run.id,
      objective: run.objective,
      status: run.status,
      createdAt: run.createdAt,
    }));
  const storedGoalEvidence = listGoalEvidence(agentId).filter(
    (item) => item.createdAt >= currentGoal.createdAt
  );
  const ledgerEvidence = mergeEvidenceRefs([
    ...listEvidence({ agentId }),
    ...(options.sessionId ? listEvidence({ sessionId: options.sessionId }) : []),
  ]).filter((item) => item.createdAt >= currentGoal.createdAt);
  const goalEvidence = mergeGoalEvidence([
    ...storedGoalEvidence,
    ...ledgerEvidence.map(evidenceRefToGoalEvidence),
  ]);
  const evaluationEvidence = mergeEvaluationEvidence([
    ...storedGoalEvidence.map(goalEvidenceToEvaluationEvidence),
    ...ledgerEvidence.map(evidenceRefToEvaluationEvidence),
  ]);
  return {
    goal: currentGoal,
    goalEvidence,
    evaluationEvidence,
    input: {
      goal: {
        objective: currentGoal.objective,
        acceptanceCriteria: currentGoal.acceptanceCriteria,
      },
      contract: currentGoal.contractId
        ? (() => {
            const contract = getExecutionContract(currentGoal.contractId);
            return contract ? toEvaluatorContractSource(contract) : null;
          })()
        : null,
      evidence: goalEvidence,
      evaluationEvidence,
      turns: listGoalTurns(agentId),
      workflowRuns,
    },
  };
}

function mergeGoalEvidence(items: GoalEvidence[]): GoalEvidence[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function mergeEvaluationEvidence(
  items: EvaluationEvidence[]
): EvaluationEvidence[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function mergeEvidenceRefs(items: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
