import type { EvaluationEvidenceTrustLevel } from "@/lib/evaluation/types";

export type EvidenceKind =
  | "browser_snapshot"
  | "browser_step"
  | "browser_annotation"
  | "workflow_artifact"
  | "subagent_result"
  | "goal_turn"
  | "approval_decision"
  | "progress_artifact"
  | "verification_result"
  | "log";

export type EvidenceTrustLevel = EvaluationEvidenceTrustLevel;

export type EvidenceSourceType =
  | "agent"
  | "browser"
  | "progress"
  | "workflow"
  | "subagent"
  | "approval"
  | "goal"
  | "task"
  | "system"
  | "unknown";

export interface EvidenceSourceRef {
  type: EvidenceSourceType;
  id?: string | null;
  parentId?: string | null;
}

export interface EvidenceCriteriaMapping {
  contractCriterionId?: string;
  rubricCriterionId?: string;
  requiredEvidence?: string;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  title: string;
  sessionId?: string | null;
  agentId?: string | null;
  browserId?: string | null;
  taskId?: string | null;
  workflowId?: string | null;
  url?: string | null;
  filePath?: string;
  screenshotDataUrl?: string | null;
  textPreview?: string;
  summary?: string;
  trustLevel?: EvidenceTrustLevel;
  source?: EvidenceSourceRef;
  criteria?: EvidenceCriteriaMapping[];
  artifactUri?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt?: number;
}

export interface EvidenceListFilter {
  sessionId?: string | null;
  agentId?: string | null;
  browserId?: string | null;
  taskId?: string | null;
  workflowId?: string | null;
  kind?: EvidenceKind;
  trustLevel?: EvidenceTrustLevel;
  sourceType?: EvidenceSourceType;
  contractCriterionId?: string;
  rubricCriterionId?: string;
}
