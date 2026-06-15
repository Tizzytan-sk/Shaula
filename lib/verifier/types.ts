import type { EvaluatorContractSource } from "@/lib/evaluation/gate";
import type {
  EvaluationEvidence,
  RubricEvaluation,
} from "@/lib/evaluation/types";

export type ReadOnlyVerifierDecision = "accept" | "reject" | "needs_review";

export interface ReadOnlyVerifierRequest {
  id: string;
  objective: string;
  contract?: EvaluatorContractSource | null;
  evidence: EvaluationEvidence[];
  rubricEvaluation?: RubricEvaluation;
  diffSummary?: string;
  finalOutput?: string;
  allowedTools: string[];
  createdAt: number;
}

export interface ReadOnlyVerifierResult {
  decision: ReadOnlyVerifierDecision;
  reason: string;
  missingEvidence: string[];
  failedCriteria: string[];
  confidence: number;
}

export interface BuildReadOnlyVerifierRequestInput {
  id?: string;
  objective: string;
  contract?: EvaluatorContractSource | null;
  evidence?: EvaluationEvidence[];
  rubricEvaluation?: RubricEvaluation;
  diffSummary?: string;
  finalOutput?: string;
  allowedTools?: string[];
  createdAt?: number;
}
