import type { EvaluationRecommendation } from "@/lib/evaluation/types";

export type EvaluationActionKind =
  | "missing_evidence"
  | "hard_fail"
  | "failed_criterion"
  | "min_score_failure"
  | "triggered_pitfall"
  | "ask_user"
  | "blocked";

export type EvaluationActionStatus = "open" | "resolved" | "waived";

export interface EvaluationAction {
  id: string;
  agentId: string;
  key: string;
  kind: EvaluationActionKind;
  status: EvaluationActionStatus;
  title: string;
  detail: string;
  target: string;
  latestEvaluationId: string;
  recommendation: EvaluationRecommendation;
  nextAction: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolutionReason?: string;
}

export interface EvaluationActionFilter {
  agentId?: string;
  status?: EvaluationActionStatus;
  kind?: EvaluationActionKind;
}
