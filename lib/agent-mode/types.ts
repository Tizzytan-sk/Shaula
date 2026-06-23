import type { AdvisoryRouteDecision } from "@/lib/task-router/types";

export type ExecutionModeKind =
  | "single_agent"
  | "subagent_coordinator"
  | "workflow_team"
  | "browser_verify"
  | "ask_user";

export interface ExecutionModeSummary {
  mode: ExecutionModeKind;
  label: string;
  detail: string;
  tone: "idle" | "running" | "warning";
  advisoryOnly: boolean;
  canSwitch: boolean;
  requiresConfirmation: boolean;
  confidence: number;
  reasons: string[];
  contextBoundary: string;
  permissionProfile: string;
}

export type ContextPacketOutputFormat = "summary" | "json" | "patch" | "review";

export interface ContextPacketRef {
  kind: string;
  ref: string;
  summary: string;
}

export interface ContextPacket {
  objective: string;
  taskTitle: string;
  taskBoundary: string;
  includeContext: ContextPacketRef[];
  excludeContext: string[];
  relevantPaths: string[];
  writePaths: string[];
  requiredEvidence: string[];
  outputContract: {
    format: ContextPacketOutputFormat;
    mustInclude: string[];
    mustNotDo: string[];
  };
  mode?: ExecutionModeKind;
  routeDecisionId?: string;
}

export interface BuildContextPacketInput {
  objective: string;
  taskTitle?: string;
  taskBoundary?: string;
  includeContext?: ContextPacketRef[];
  excludeContext?: string[];
  relevantPaths?: string[];
  writePaths?: string[];
  requiredEvidence?: string[];
  outputFormat?: ContextPacketOutputFormat;
  mustInclude?: string[];
  mustNotDo?: string[];
  modeSummary?: ExecutionModeSummary;
  routeDecision?: AdvisoryRouteDecision | null;
}
