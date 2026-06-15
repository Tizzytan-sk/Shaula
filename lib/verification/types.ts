export type VerificationCheckKind =
  | "test"
  | "lint"
  | "build"
  | "typecheck"
  | "browser_observation";

export type VerificationCheckStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "skipped";

export interface VerificationCommandCheck {
  id: string;
  type: "command";
  kind: Exclude<VerificationCheckKind, "browser_observation">;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  required: boolean;
  evidenceRequired: string[];
  rationale: string;
}

export interface VerificationBrowserCheck {
  id: string;
  type: "browser_observation";
  kind: "browser_observation";
  label: string;
  targetUrl?: string;
  required: boolean;
  evidenceRequired: string[];
  rationale: string;
}

export type VerificationCheck =
  | VerificationCommandCheck
  | VerificationBrowserCheck;

export interface VerificationPlan {
  id: string;
  agentId?: string;
  contractId?: string;
  objective: string;
  profileId?: string;
  checks: VerificationCheck[];
  createdAt: number;
}

export interface VerificationPlanInferenceInput {
  agentId?: string;
  contractId?: string;
  objective: string;
  profileId?: string;
  requiredEvidence?: string[];
  acceptanceCriteria?: Array<{
    id?: string;
    description?: string;
    criterion?: string;
    evidenceRequired?: string[];
  }>;
  changedFiles?: string[];
  packageScripts?: Record<string, string>;
  hasTypeScriptConfig?: boolean;
  cwd: string;
  targetUrl?: string;
  createdAt?: number;
  id?: string;
}

export interface VerificationCommandResult {
  planId?: string;
  commandId: string;
  kind: VerificationCommandCheck["kind"];
  label: string;
  command: string;
  args: string[];
  cwd: string;
  required: boolean;
  evidenceRequired: string[];
  rationale?: string;
  status: Exclude<VerificationCheckStatus, "pending" | "running" | "skipped">;
  exitCode: number | null;
  stdoutPreview?: string;
  stderrPreview?: string;
  durationMs: number;
  startedAt: number;
  completedAt: number;
  timedOut?: boolean;
}
