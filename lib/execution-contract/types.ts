import type { EvaluatorContractSource } from "@/lib/evaluation/gate";

export const EXECUTION_CONTRACT_VERSION = 1 as const;

export type ExecutionContractVersion = typeof EXECUTION_CONTRACT_VERSION;

export interface ExecutionAcceptanceCriterion {
  id: string;
  description: string;
  required: boolean;
  evidenceRequired?: string[];
}

export interface ExecutionBudgetHints {
  tokenBudget?: number;
  maxTurns?: number;
}

export interface ExecutionStopPolicy {
  targetScore?: number;
  minDelta?: number;
  maxIterations?: number;
  askUserWhenBlocked?: boolean;
}

export type ExecutionMainArtifactKind =
  | "file"
  | "directory"
  | "url"
  | "route"
  | "other";

export interface ExecutionMainArtifact {
  kind: ExecutionMainArtifactKind;
  label: string;
  href?: string;
  source: "explicit" | "attachment" | "scope" | "objective" | "inferred";
}

export interface ExecutionProfileSelection {
  source: "inferred" | "override";
  selectedProfile: string;
  inferredProfile: string;
  overrideProfile?: string;
}

export interface ExecutionContract {
  id: string;
  version: ExecutionContractVersion;
  agentId: string;
  objective: string;
  scope: string[];
  nonGoals: string[];
  acceptanceCriteria: ExecutionAcceptanceCriterion[];
  requiredEvidence: string[];
  mainArtifact?: ExecutionMainArtifact;
  rubricProfile: string;
  profileSelection?: ExecutionProfileSelection;
  allowedCapabilities: string[];
  budgetHints?: ExecutionBudgetHints;
  stopPolicy?: ExecutionStopPolicy;
  createdAt: number;
  updatedAt: number;
}

export type ExecutionContractSummary = Pick<
  ExecutionContract,
  | "id"
  | "objective"
  | "scope"
  | "nonGoals"
  | "acceptanceCriteria"
  | "requiredEvidence"
  | "mainArtifact"
  | "rubricProfile"
  | "profileSelection"
  | "allowedCapabilities"
  | "budgetHints"
  | "stopPolicy"
>;

export function toEvaluatorContractSource(
  contract: ExecutionContract | ExecutionContractSummary
): EvaluatorContractSource {
  return {
    objective: contract.objective,
    scope: contract.scope,
    nonGoals: contract.nonGoals,
    requiredEvidence: contract.requiredEvidence,
    mainArtifact: contract.mainArtifact,
    rubricProfile: contract.rubricProfile,
    stopPolicy: contract.stopPolicy,
  };
}
