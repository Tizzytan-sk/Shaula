import type { RubricEvaluation } from "@/lib/evaluation/types";
import type { EvidenceRef } from "@/lib/evidence/types";

export type SkillEvalCaseKind = "positive" | "negative" | "edge";
export type SkillEvalCaseStatus = "pass" | "partial" | "fail";

export interface SkillEvalCase {
  id: string;
  title: string;
  prompt: string;
  expectedBehavior?: string;
  kind?: SkillEvalCaseKind;
  weight?: number;
}

export interface SkillEvalCaseResult {
  caseId: string;
  status: SkillEvalCaseStatus;
  score?: number;
  reason: string;
  outputPreview?: string;
  evidenceIds?: string[];
  metadata?: SkillEvalRunMetrics;
}

export interface SkillEvalRunMetrics {
  modelTier?: "strong_control" | "main_low_cost" | "weak_pressure" | "very_weak_probe" | string;
  turnCount?: number;
  verifierRejectionCount?: number;
  openActionCount?: number;
  changedFiles?: string[];
  testsRun?: string[];
  browserEvidence?: string[];
  manualIntervention?: boolean;
  route?: string;
  executionSemantics?: "advisory_only" | "hard_routed" | string;
}

export interface SkillEvalVersionDiff {
  baselineVersion?: string;
  candidateVersion?: string;
  summary?: string;
  filePath?: string;
}

export interface SkillEvalRunInput {
  id?: string;
  agentId?: string;
  sessionId?: string | null;
  skillName: string;
  skillPath?: string;
  skillPackage?: string;
  objective?: string;
  baselineVersion?: string;
  candidateVersion?: string;
  versionDiff?: SkillEvalVersionDiff;
  metrics?: SkillEvalRunMetrics;
  cases: SkillEvalCase[];
  results: SkillEvalCaseResult[];
  createdAt?: number;
}

export interface SkillEvalCaseSummary {
  caseId: string;
  title: string;
  kind: SkillEvalCaseKind;
  status: SkillEvalCaseStatus;
  score: number;
  weight: number;
  reason: string;
}

export interface SkillEvalRun {
  id: string;
  agentId?: string;
  sessionId?: string | null;
  skillName: string;
  skillPath?: string;
  skillPackage?: string;
  objective: string;
  baselineVersion?: string;
  candidateVersion?: string;
  versionDiff?: SkillEvalVersionDiff;
  metrics?: SkillEvalRunMetrics;
  cases: SkillEvalCase[];
  results: SkillEvalCaseSummary[];
  weightedScore: number;
  passCount: number;
  partialCount: number;
  failCount: number;
  evaluation: RubricEvaluation;
  evidence: EvidenceRef[];
  createdAt: number;
}
